"""索引器 resolver 测试：caller 推断 + callee 名称保守匹配。

阶段 2 第四、五个 TDD 循环。
- 循环 4：assign_callers —— 调用点落在哪个函数的行范围内（最内层规则）
- 循环 5：resolve_callees —— 按名称匹配定义（唯一才填充）
"""

from __future__ import annotations

from pathlib import Path

from code_archmage.indexer.resolver import assign_callers, resolve_callees
from code_archmage.indexer.schema import init_db
from code_archmage.indexer.writer import index_file
from code_archmage.parser.parser import parse


class TestAssignCallers:
    """循环 4：caller 推断——最内层 function 规则。"""

    def test_nested_function_innermost(self, fixtures_dir: Path) -> None:
        """嵌套函数：foo() 在 inner 内调用 → caller_id = inner（最内层，不是 outer）。"""
        result = parse(fixtures_dir / "nested_function.py")
        conn = init_db(":memory:")
        index_file(conn, fixtures_dir, result)
        assign_callers(conn)

        # foo() 在 line 3，落在 inner(2-3) 和 outer(1-5) 内，取最内层 inner
        foo_call = conn.execute("SELECT caller_id FROM calls WHERE callee_name='foo'").fetchone()
        inner_id = conn.execute("SELECT id FROM symbols WHERE name='inner'").fetchone()
        conn.close()

        assert foo_call is not None
        assert inner_id is not None
        assert foo_call[0] == inner_id[0]

    def test_outer_level_call(self, fixtures_dir: Path) -> None:
        """outer() 内直接调用 inner() → caller_id = outer。"""
        result = parse(fixtures_dir / "nested_function.py")
        conn = init_db(":memory:")
        index_file(conn, fixtures_dir, result)
        assign_callers(conn)

        # inner() 在 line 5，只落在 outer(1-5) 内
        inner_call = conn.execute(
            "SELECT caller_id FROM calls WHERE callee_name='inner'"
        ).fetchone()
        outer_id = conn.execute("SELECT id FROM symbols WHERE name='outer'").fetchone()
        conn.close()

        assert inner_call is not None
        assert outer_id is not None
        assert inner_call[0] == outer_id[0]

    def test_method_call_caller_is_method_not_class(self, fixtures_dir: Path) -> None:
        """方法体内的调用 → caller_id = 方法 id（不是类 id，跳过 class 范围）。"""
        result = parse(fixtures_dir / "class_method_call.py")
        conn = init_db(":memory:")
        index_file(conn, fixtures_dir, result)
        assign_callers(conn)

        # class_method_call.py: Calculator 类的 compute() 方法调用 add()
        # add() 的 caller 应是 compute（function），不是 Calculator（class）
        add_call = conn.execute("SELECT caller_id FROM calls WHERE callee_name='add'").fetchone()
        compute_id = conn.execute("SELECT id FROM symbols WHERE name='compute'").fetchone()
        calc_id = conn.execute("SELECT id FROM symbols WHERE name='Calculator'").fetchone()
        conn.close()

        assert add_call is not None
        assert compute_id is not None
        assert calc_id is not None
        # caller 是 compute（方法），不是 Calculator（类）
        assert add_call[0] == compute_id[0]
        assert add_call[0] != calc_id[0]

    def test_module_level_call_null(self, tmp_path: Path) -> None:
        """模块级调用（不在任何函数体内）→ caller_id = NULL。"""
        py_file = tmp_path / "mod.py"
        py_file.write_bytes(b"print('hello')\n")

        from code_archmage.parser.parser import parse_source

        result = parse_source(py_file.read_bytes(), str(py_file))
        conn = init_db(":memory:")
        index_file(conn, tmp_path, result)
        assign_callers(conn)

        caller_ids = conn.execute("SELECT caller_id FROM calls").fetchall()
        conn.close()

        assert len(caller_ids) == 1
        assert caller_ids[0][0] is None


class TestResolveCallees:
    """循环 5：callee 名称保守匹配——唯一才填充。"""

    def test_unique_callee_resolved(self, fixtures_dir: Path) -> None:
        """全库唯一同名定义 → callee_id 被填充。"""
        conn = init_db(":memory:")
        # 索引两个跨文件 fixture
        index_file(conn, fixtures_dir, parse(fixtures_dir / "cross_file_a.py"))
        index_file(conn, fixtures_dir, parse(fixtures_dir / "cross_file_b.py"))
        resolve_callees(conn)

        # cross_file_a 调用 bar()，cross_file_b 定义 bar()（全库唯一）
        bar_call = conn.execute("SELECT callee_id FROM calls WHERE callee_name='bar'").fetchone()
        bar_def = conn.execute("SELECT id FROM symbols WHERE name='bar'").fetchone()
        conn.close()

        assert bar_call is not None
        assert bar_def is not None
        assert bar_call[0] == bar_def[0]

    def test_multi_candidate_callee_null(self, fixtures_dir: Path) -> None:
        """同名多定义 → callee_id = NULL（保守匹配，不猜）。"""
        conn = init_db(":memory:")
        index_file(conn, fixtures_dir, parse(fixtures_dir / "name_collision_a.py"))
        index_file(conn, fixtures_dir, parse(fixtures_dir / "name_collision_b.py"))
        resolve_callees(conn)

        # 两个文件都定义 setup()，name_collision_b 调用 setup()
        setup_call = conn.execute(
            "SELECT callee_id FROM calls WHERE callee_name='setup'"
        ).fetchone()
        conn.close()

        assert setup_call is not None
        assert setup_call[0] is None  # 多候选 → NULL

    def test_no_definition_callee_null(self, fixtures_dir: Path) -> None:
        """无定义（如内置函数 print）→ callee_id = NULL。"""
        conn = init_db(":memory:")
        index_file(conn, fixtures_dir, parse(fixtures_dir / "nested_calls.py"))
        resolve_callees(conn)

        # nested_calls.py 调用 foo/baz/a/b/c，但都没有定义
        callee_ids = conn.execute("SELECT callee_id FROM calls").fetchall()
        conn.close()

        for cid in callee_ids:
            assert cid[0] is None
