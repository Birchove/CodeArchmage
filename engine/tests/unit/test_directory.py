"""索引器目录级测试：全量索引 + 增量索引 + 先删后写 + 孤儿清理。

阶段 2 第六个 TDD 循环。用 tmp_path 造可控目录，验证：
- 全量索引正确
- 增量索引幂等（无改动不重复写入）
- 修改文件后先删后写（旧符号消失、新符号出现）
- 删除文件后孤儿数据清理
- 路径规范化
"""

from __future__ import annotations

from pathlib import Path

import pytest

from code_archmage.indexer.resolver import assign_callers, resolve_callees
from code_archmage.indexer.schema import init_db
from code_archmage.indexer.writer import index_directory


class TestIndexDirectory:
    """索引整个目录。"""

    def test_full_index_all_files(self, fixtures_dir: Path) -> None:
        """全量索引 fixtures/python/ → files 表记录所有 .py 文件。"""
        conn = init_db(":memory:")
        index_directory(conn, fixtures_dir)
        assign_callers(conn)
        resolve_callees(conn)

        files = conn.execute("SELECT path FROM files ORDER BY path").fetchall()
        conn.close()

        # 应包含所有 .py 文件（阶段 1 的 8 个 + 阶段 2 新增 6 个 = 14 个）
        py_count = sum(1 for _ in fixtures_dir.rglob("*.py"))
        assert len(files) == py_count
        # 路径都是相对的 POSIX 路径
        for (path,) in files:
            assert not path.startswith("/")
            assert "\\" not in path

    def test_idempotent_reindex(self, fixtures_dir: Path) -> None:
        """二次索引（无改动）→ 各表行数不变。"""
        conn = init_db(":memory:")
        index_directory(conn, fixtures_dir)

        counts_before = {
            "files": conn.execute("SELECT count(*) FROM files").fetchone()[0],
            "symbols": conn.execute("SELECT count(*) FROM symbols").fetchone()[0],
            "calls": conn.execute("SELECT count(*) FROM calls").fetchone()[0],
            "imports": conn.execute("SELECT count(*) FROM imports").fetchone()[0],
        }

        # 二次索引
        index_directory(conn, fixtures_dir)

        counts_after = {
            "files": conn.execute("SELECT count(*) FROM files").fetchone()[0],
            "symbols": conn.execute("SELECT count(*) FROM symbols").fetchone()[0],
            "calls": conn.execute("SELECT count(*) FROM calls").fetchone()[0],
            "imports": conn.execute("SELECT count(*) FROM imports").fetchone()[0],
        }
        conn.close()

        assert counts_after == counts_before

    def test_modify_file_delete_then_write(self, tmp_path: Path) -> None:
        """修改文件后重新索引 → 旧符号消失、新符号出现（先删后写）。"""
        # 造初始文件
        f1 = tmp_path / "mod.py"
        f1.write_bytes(b"def old_func():\n    pass\n")

        conn = init_db(":memory:")
        index_directory(conn, tmp_path)

        old_symbols = conn.execute("SELECT name FROM symbols").fetchall()
        assert old_symbols == [("old_func",)]

        # 修改文件：删掉 old_func，加 new_func
        f1.write_bytes(b"def new_func():\n    pass\n")
        index_directory(conn, tmp_path)

        new_symbols = conn.execute("SELECT name FROM symbols").fetchall()
        conn.close()

        # old_func 应消失，new_func 应出现
        assert ("old_func",) not in new_symbols
        assert ("new_func",) in new_symbols

    def test_delete_file_orphan_cleanup(self, tmp_path: Path) -> None:
        """删除文件后重新索引 → 该文件的 symbols/calls/imports 全部消失。"""
        # 造两个文件
        f1 = tmp_path / "keep.py"
        f1.write_bytes(b"def keep_func():\n    pass\n")
        f2 = tmp_path / "delete_me.py"
        f2.write_bytes(b"def delete_func():\n    pass\n")

        conn = init_db(":memory:")
        index_directory(conn, tmp_path)

        assert conn.execute("SELECT count(*) FROM files").fetchone()[0] == 2
        assert conn.execute("SELECT count(*) FROM symbols").fetchone()[0] == 2

        # 删除 delete_me.py
        f2.unlink()
        index_directory(conn, tmp_path)

        files = conn.execute("SELECT path FROM files").fetchall()
        symbols = conn.execute("SELECT name, file_path FROM symbols").fetchall()
        conn.close()

        # delete_me.py 应从 files 表消失
        assert ("delete_me.py",) not in files
        assert ("keep.py",) in files
        # delete_func 应从 symbols 表消失
        symbol_names = {s[0] for s in symbols}
        assert "delete_func" not in symbol_names
        assert "keep_func" in symbol_names

    def test_skip_pycache(self, tmp_path: Path) -> None:
        """__pycache__ 目录被跳过。"""
        (tmp_path / "__pycache__").mkdir()
        (tmp_path / "__pycache__" / "mod.cpython-312.pyc").write_bytes(b"fake bytecode")
        (tmp_path / "real.py").write_bytes(b"def foo():\n    pass\n")

        conn = init_db(":memory:")
        index_directory(conn, tmp_path)

        files = conn.execute("SELECT path FROM files").fetchall()
        conn.close()

        assert files == [("real.py",)]

    def test_resolver_runs_after_directory_index(self, fixtures_dir: Path) -> None:
        """index_directory 后手动跑 resolver，跨文件 callee 正确解析。"""
        conn = init_db(":memory:")
        index_directory(conn, fixtures_dir)
        assign_callers(conn)
        resolve_callees(conn)

        # cross_file_a 调用 bar()，cross_file_b 定义 bar()（全库唯一）
        bar_call = conn.execute("SELECT callee_id FROM calls WHERE callee_name='bar'").fetchone()
        bar_def = conn.execute("SELECT id FROM symbols WHERE name='bar'").fetchone()
        conn.close()

        assert bar_call is not None
        assert bar_def is not None
        assert bar_call[0] == bar_def[0]


class TestDirectoryEdgeCases:
    """循环 6b：venv 过滤 + ParseError 处理。"""

    def test_skip_venv(self, tmp_path: Path) -> None:
        """.venv 目录被跳过。"""
        (tmp_path / ".venv").mkdir()
        (tmp_path / ".venv" / "site.py").write_bytes(b"def venv_func():\n    pass\n")
        (tmp_path / "real.py").write_bytes(b"def app_func():\n    pass\n")

        conn = init_db(":memory:")
        index_directory(conn, tmp_path)

        files = conn.execute("SELECT path FROM files ORDER BY path").fetchall()
        conn.close()

        assert files == [("real.py",)]

    def test_syntax_error_partial_index(self, fixtures_dir: Path) -> None:
        """含语法错误的文件不崩溃，能解析的符号照常索引。"""
        conn = init_db(":memory:")
        index_directory(conn, fixtures_dir)

        # syntax_error.py 应在 files 表中（照常记录）
        se_file = conn.execute("SELECT path FROM files WHERE path = 'syntax_error.py'").fetchone()
        assert se_file is not None

        # good_function 应被索引（语法错误前的有效定义）
        good = conn.execute("SELECT name FROM symbols WHERE name = 'good_function'").fetchone()
        conn.close()

        assert good is not None


class TestSymlinkNotIndexed:
    """循环 3：符号链接逃逸（索引侧）—— cc S-1 修复。

    rglob("*.py") 会收集 symlink .py 文件，把仓库外代码吸进索引库。
    _iter_python_files 必须过滤 is_symlink() 条目。
    """

    def test_symlink_py_not_indexed(
        self, tmp_path: Path, tmp_path_factory: pytest.TempPathFactory
    ) -> None:
        """仓库内 symlink .py 指向仓库外 → 不被索引。"""
        # 仓库外放一个"机密"文件
        outside = tmp_path_factory.mktemp("outside")
        (outside / "secret.py").write_bytes(b"def leak_secret():\n    return 'COMPANY_CODE'\n")

        # 仓库内放一个正常文件 + 一个指向外部的 symlink
        (tmp_path / "safe.py").write_bytes(b"def safe_func():\n    pass\n")
        (tmp_path / "leak.py").symlink_to(outside / "secret.py")

        conn = init_db(":memory:")
        index_directory(conn, tmp_path)

        files = conn.execute("SELECT path FROM files ORDER BY path").fetchall()
        symbols = conn.execute("SELECT name FROM symbols").fetchall()
        conn.close()

        # leak.py（symlink）不应被索引
        assert ("leak.py",) not in files
        assert ("safe.py",) in files
        # leak_secret 不应进入符号表
        assert ("leak_secret",) not in symbols
        assert ("safe_func",) in symbols

    def test_iter_python_files_skips_symlinks(
        self, tmp_path: Path, tmp_path_factory: pytest.TempPathFactory
    ) -> None:
        """_iter_python_files 直接过滤 symlink。"""
        from code_archmage.indexer.writer import _iter_python_files

        outside = tmp_path_factory.mktemp("outside2")
        (outside / "ext.py").write_bytes(b"x = 1\n")
        (tmp_path / "real.py").write_bytes(b"y = 2\n")
        (tmp_path / "link.py").symlink_to(outside / "ext.py")

        result = _iter_python_files(tmp_path)
        names = {p.name for p in result}

        assert "real.py" in names
        assert "link.py" not in names
