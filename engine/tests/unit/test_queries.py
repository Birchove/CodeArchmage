"""索引器查询接口测试：定义 / 引用 / 调用者 / 被调用者。

阶段 2 第七、八个 TDD 循环。索引 fixtures 后跑查询，断言结果正确。
"""

from __future__ import annotations

from pathlib import Path

from code_archmage.indexer.queries import (
    find_callees,
    find_callers,
    find_definition,
    find_references,
)
from code_archmage.indexer.resolver import assign_callers, resolve_callees
from code_archmage.indexer.schema import init_db
from code_archmage.indexer.writer import index_directory
from code_archmage.parser.models import Symbol, SymbolKind


def _index_fixtures(conn, fixtures_dir: Path) -> None:
    """索引 fixtures 并跑 resolver（测试辅助）。"""
    index_directory(conn, fixtures_dir)
    assign_callers(conn)
    resolve_callees(conn)


def _find_symbol(conn, name: str, file_suffix: str = "") -> Symbol:
    """从 DB 取一个 Symbol（测试辅助）。"""
    from code_archmage.indexer.queries import find_definition

    defs = find_definition(conn, name)
    if file_suffix:
        defs = [d for d in defs if d.file_path.endswith(file_suffix)]
    assert len(defs) == 1, f"期望 1 个 {name}，找到 {len(defs)} 个"
    return defs[0]


class TestFindDefinition:
    """循环 7：按名称查定义。"""

    def test_find_unique_definition(self, fixtures_dir: Path) -> None:
        """全库唯一的名称 → 返回 1 个 Symbol。"""
        conn = init_db(":memory:")
        _index_fixtures(conn, fixtures_dir)

        results = find_definition(conn, "bar")
        conn.close()

        assert len(results) == 1
        assert results[0].name == "bar"
        assert results[0].kind == SymbolKind.FUNCTION
        assert results[0].file_path == "cross_file_b.py"

    def test_find_multiple_definitions(self, fixtures_dir: Path) -> None:
        """同名多定义 → 返回多个候选。"""
        conn = init_db(":memory:")
        _index_fixtures(conn, fixtures_dir)

        results = find_definition(conn, "setup")
        conn.close()

        assert len(results) == 2
        assert all(r.name == "setup" for r in results)

    def test_find_nonexistent(self, fixtures_dir: Path) -> None:
        """不存在的名称 → 返回空列表。"""
        conn = init_db(":memory:")
        _index_fixtures(conn, fixtures_dir)

        results = find_definition(conn, "zzz不存在")
        conn.close()

        assert results == []

    def test_returns_symbol_with_all_fields(self, fixtures_dir: Path) -> None:
        """返回的 Symbol 含所有字段（bases / decorators 从 JSON 还原）。"""
        conn = init_db(":memory:")
        _index_fixtures(conn, fixtures_dir)

        dog = _find_symbol(conn, "Dog", "class_with_methods.py")
        conn.close()

        assert dog.name == "Dog"
        assert dog.kind == SymbolKind.CLASS
        assert "Animal" in dog.bases


class TestFindReferences:
    """循环 7：查引用点（调用 + 导入）。"""

    def test_find_call_reference(self, fixtures_dir: Path) -> None:
        """bar 的引用包含调用点。"""
        conn = init_db(":memory:")
        _index_fixtures(conn, fixtures_dir)

        bar_id = _symbol_id_by_file(conn, "bar", "cross_file_b.py")
        refs = find_references(conn, symbol_id=bar_id)
        conn.close()

        # 至少有 1 个引用（cross_file_a.py 中的调用）
        assert len(refs) >= 1
        # 有来自 cross_file_a.py 的引用
        ref_files = {r.file_path for r in refs}
        assert "cross_file_a.py" in ref_files

    def test_find_import_reference(self, fixtures_dir: Path) -> None:
        """bar 的引用也包含导入点。"""
        conn = init_db(":memory:")
        _index_fixtures(conn, fixtures_dir)

        bar_id = _symbol_id_by_file(conn, "bar", "cross_file_b.py")
        refs = find_references(conn, symbol_id=bar_id)
        conn.close()

        # 引用中应有 kind="import" 的
        kinds = {r.kind for r in refs}
        assert "import" in kinds

    def test_no_references(self, fixtures_dir: Path) -> None:
        """无人引用的符号 → 返回空。"""
        conn = init_db(":memory:")
        _index_fixtures(conn, fixtures_dir)

        # good_function 只在 syntax_error.py 中定义，无人调用/导入
        refs = find_references(conn, symbol_id=_symbol_id(conn, "good_function"))
        conn.close()

        assert refs == []


def _symbol_id(conn, name: str) -> int:
    """按名称取第一个匹配的 symbol id（测试辅助）。"""
    row = conn.execute("SELECT id FROM symbols WHERE name=? LIMIT 1", (name,)).fetchone()
    assert row is not None
    return row[0]


def _symbol_id_by_file(conn, name: str, file_suffix: str) -> int:
    """按名称 + 文件后缀取 symbol id（测试辅助，用于消歧）。"""
    row = conn.execute(
        "SELECT id FROM symbols WHERE name=? AND file_path LIKE ?",
        (name, f"%{file_suffix}"),
    ).fetchone()
    assert row is not None
    return row[0]


class TestFindCallers:
    """循环 8：查调用者。"""

    def test_find_callers_of_unique_name(self, fixtures_dir: Path) -> None:
        """调用 bar() 的函数 → 返回 caller。"""
        conn = init_db(":memory:")
        _index_fixtures(conn, fixtures_dir)

        callers = find_callers(conn, "bar")
        conn.close()

        assert len(callers) == 1
        assert callers[0].name == "caller"
        assert callers[0].file_path == "cross_file_a.py"

    def test_find_callers_none(self, fixtures_dir: Path) -> None:
        """无人调用的名称 → 返回空。"""
        conn = init_db(":memory:")
        _index_fixtures(conn, fixtures_dir)

        callers = find_callers(conn, "good_function")
        conn.close()

        assert callers == []


class TestFindCallees:
    """循环 8：查被调用者（含多候选）。"""

    def test_find_callees_of_caller(self, fixtures_dir: Path) -> None:
        """caller() 调用 bar() → find_callees 返回 bar。"""
        conn = init_db(":memory:")
        _index_fixtures(conn, fixtures_dir)

        callees = find_callees(conn, _symbol_id(conn, "caller"))
        conn.close()

        assert len(callees) == 1
        assert callees[0].name == "bar"

    def test_find_callees_multi_candidate(self, fixtures_dir: Path) -> None:
        """run() 调用 setup()，但 setup 有两个定义 → 返回多个候选。"""
        conn = init_db(":memory:")
        _index_fixtures(conn, fixtures_dir)

        callees = find_callees(conn, _symbol_id(conn, "run"))
        conn.close()

        # setup 有两个定义（name_collision_a + b），都应返回
        setup_results = [c for c in callees if c.name == "setup"]
        assert len(setup_results) == 2
