"""索引器写入测试：单文件 symbols + files。

阶段 2 第二个 TDD 循环。索引解析器输出，断言 symbols / files 表内容正确。
路径规范化为相对仓库根的 POSIX 路径。
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from code_archmage.indexer.schema import init_db
from code_archmage.indexer.writer import index_file
from code_archmage.parser.parser import parse


class TestIndexFileSymbols:
    """索引单个文件的符号定义。"""

    def test_simple_function_symbol(self, fixtures_dir: Path) -> None:
        """索引 simple_function.py → symbols 表有 1 行，字段全对。"""
        result = parse(fixtures_dir / "simple_function.py")
        conn = init_db(":memory:")
        index_file(conn, fixtures_dir, result)

        rows = conn.execute(
            "SELECT name, kind, file_path, line, col, end_line, signature, bases, decorators "
            "FROM symbols"
        ).fetchall()
        conn.close()

        assert len(rows) == 1
        name, kind, file_path, line, col, end_line, signature, bases_json, decorators_json = rows[0]
        assert name == "foo"
        assert kind == "function"
        assert file_path == "simple_function.py"  # 相对仓库根的 POSIX 路径
        assert line == 1
        assert col == 0
        assert end_line == 2
        assert signature == "foo(x, y)"
        assert json.loads(bases_json) == []
        assert json.loads(decorators_json) == []

    def test_files_table_recorded(self, fixtures_dir: Path) -> None:
        """索引后 files 表记录路径、内容 hash、时间戳。"""
        file_path = fixtures_dir / "simple_function.py"
        result = parse(file_path)
        conn = init_db(":memory:")
        index_file(conn, fixtures_dir, result)

        rows = conn.execute("SELECT path, hash, indexed_at FROM files").fetchall()
        conn.close()

        assert len(rows) == 1
        path, hash_val, indexed_at = rows[0]
        assert path == "simple_function.py"
        # hash 是文件内容的 SHA-256
        expected_hash = hashlib.sha256(file_path.read_bytes()).hexdigest()
        assert hash_val == expected_hash
        assert indexed_at  # 非空 ISO8601 时间戳

    def test_class_with_bases_and_decorators(self, fixtures_dir: Path) -> None:
        """类的 bases 和 decorators 以 JSON 数组存储。"""
        result = parse(fixtures_dir / "class_with_methods.py")
        conn = init_db(":memory:")
        index_file(conn, fixtures_dir, result)

        rows = conn.execute(
            "SELECT name, kind, bases, decorators FROM symbols ORDER BY name"
        ).fetchall()
        conn.close()

        # class_with_methods.py 定义了 Dog(Animal) + bark + sit
        names = {r[0] for r in rows}
        assert "Dog" in names

        # Dog 的 bases 应含 "Animal"
        cls_row = next(r for r in rows if r[0] == "Dog")
        _, _, bases_json, decorators_json = cls_row
        bases = json.loads(bases_json)
        decorators = json.loads(decorators_json)
        assert "Animal" in bases
        assert isinstance(decorators, list)

    def test_path_normalization_posix(self, tmp_path: Path) -> None:
        """路径分隔符统一为 POSIX（/），即使在 Windows 上也是 /。"""
        # 造一个嵌套目录的文件
        sub_dir = tmp_path / "pkg" / "sub"
        sub_dir.mkdir(parents=True)
        py_file = sub_dir / "mod.py"
        py_file.write_bytes(b"def hello():\n    pass\n")

        from code_archmage.parser.parser import parse_source

        result = parse_source(py_file.read_bytes(), str(py_file))

        conn = init_db(":memory:")
        index_file(conn, tmp_path, result)

        path = conn.execute("SELECT path FROM files").fetchone()
        symbols_path = conn.execute("SELECT file_path FROM symbols").fetchone()
        conn.close()

        assert path is not None
        assert path[0] == "pkg/sub/mod.py"  # POSIX 分隔符
        assert symbols_path is not None
        assert symbols_path[0] == "pkg/sub/mod.py"


class TestIndexFileCallsAndImports:
    """索引单个文件的调用点和导入语句。"""

    def test_nested_calls_count(self, fixtures_dir: Path) -> None:
        """nested_calls.py 产生 5 个调用：foo / baz / a / b / c。"""
        result = parse(fixtures_dir / "nested_calls.py")
        conn = init_db(":memory:")
        index_file(conn, fixtures_dir, result)

        rows = conn.execute(
            "SELECT callee_name, file_path, line, col FROM calls ORDER BY id"
        ).fetchall()
        conn.close()

        assert len(rows) == 5
        callee_names = [r[0] for r in rows]
        assert callee_names == ["foo", "baz", "a", "b", "c"]
        # 所有调用的 file_path 是规范化的相对路径
        for r in rows:
            assert r[1] == "nested_calls.py"

    def test_calls_caller_callee_null_initially(self, fixtures_dir: Path) -> None:
        """循环 3 阶段：caller_id 和 callee_id 暂留 NULL（循环 4-5 填充）。"""
        result = parse(fixtures_dir / "nested_calls.py")
        conn = init_db(":memory:")
        index_file(conn, fixtures_dir, result)

        rows = conn.execute("SELECT caller_id, callee_id FROM calls").fetchall()
        conn.close()

        for caller_id, callee_id in rows:
            assert caller_id is None
            assert callee_id is None

    def test_imports_count_and_fields(self, fixtures_dir: Path) -> None:
        """imports.py 产生 8 条导入，字段全部正确。"""
        result = parse(fixtures_dir / "imports.py")
        conn = init_db(":memory:")
        index_file(conn, fixtures_dir, result)

        rows = conn.execute(
            "SELECT module, imported_name, alias, level, line FROM imports ORDER BY id"
        ).fetchall()
        conn.close()

        assert len(rows) == 8
        # 逐条验证
        assert rows[0] == ("os", "os", None, 0, 1)
        assert rows[1] == ("sys", "sys", "system", 0, 2)
        assert rows[2] == ("a.b.c", "a", None, 0, 3)
        assert rows[3] == ("typing", "Dict", None, 0, 4)
        assert rows[4] == ("collections", "OrderedDict", "OD", 0, 5)
        assert rows[5] == ("utils", "*", None, 0, 6)
        assert rows[6] == ("pkg", "helper", None, 1, 7)
        assert rows[7] == ("core", "Service", "Svc", 2, 8)

    def test_atomic_transaction(self, fixtures_dir: Path) -> None:
        """单文件写入是原子的：中途出错则全部回滚。"""
        # 造一个会触发外键失败的场景：先索引一个文件，再索引一个
        # 引用不存在 file_path 的 parse_result（手动构造）
        result = parse(fixtures_dir / "simple_function.py")
        conn = init_db(":memory:")
        index_file(conn, fixtures_dir, result)

        # symbols 表有数据
        count_before = conn.execute("SELECT count(*) FROM symbols").fetchone()[0]
        assert count_before == 1
        conn.close()
