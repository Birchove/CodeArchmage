"""索引器集成测试：全目录索引 + 全套查询。

阶段 2 集成测试。索引整个 fixtures/python/ 目录，
跑全套查询接口，断言跨文件关系正确。
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
from code_archmage.indexer.search import search_fts
from code_archmage.indexer.writer import index_directory


def test_full_pipeline_index_and_query(fixtures_dir: Path) -> None:
    """全流程：索引整个目录 → resolver → 查询接口全部可用。"""
    conn = init_db(":memory:")
    index_directory(conn, fixtures_dir)
    assign_callers(conn)
    resolve_callees(conn)

    # 1. files 表记录了所有 .py 文件
    py_count = sum(1 for _ in fixtures_dir.rglob("*.py"))
    db_files = conn.execute("SELECT count(*) FROM files").fetchone()[0]
    assert db_files == py_count

    # 2. find_definition：跨文件唯一名称
    bar_defs = find_definition(conn, "bar")
    assert len(bar_defs) == 1
    assert bar_defs[0].file_path == "cross_file_b.py"

    # 3. find_definition：同名多定义
    setup_defs = find_definition(conn, "setup")
    assert len(setup_defs) == 2

    # 4. find_references：bar 有调用 + 导入引用
    bar_id = conn.execute(
        "SELECT id FROM symbols WHERE name='bar' AND file_path='cross_file_b.py'"
    ).fetchone()[0]
    bar_refs = find_references(conn, symbol_id=bar_id)
    ref_kinds = {r.kind for r in bar_refs}
    assert "call" in ref_kinds
    assert "import" in ref_kinds

    # 5. find_callers：bar 的调用者是 caller
    bar_callers = find_callers(conn, "bar")
    assert len(bar_callers) == 1
    assert bar_callers[0].name == "caller"

    # 6. find_callees：caller 调用 bar
    caller_id = conn.execute(
        "SELECT id FROM symbols WHERE name='caller' AND file_path='cross_file_a.py'"
    ).fetchone()[0]
    caller_callees = find_callees(conn, caller_id)
    assert len(callees := [c.name for c in caller_callees]) == 1
    assert "bar" in callees

    # 7. find_callees：多候选（run 调用 setup，setup 有两个定义）
    run_id = conn.execute("SELECT id FROM symbols WHERE name='run'").fetchone()[0]
    run_callees = find_callees(conn, run_id)
    setup_results = [c for c in run_callees if c.name == "setup"]
    assert len(setup_results) == 2

    # 8. search_fts：按名称搜索
    dog_results = search_fts(conn, "Dog")
    assert len(dog_results) == 1
    assert dog_results[0].name == "Dog"

    conn.close()


def test_incremental_reindex_idempotent(fixtures_dir: Path) -> None:
    """增量索引幂等：连续两次全量索引，各表行数不变。"""
    conn = init_db(":memory:")
    index_directory(conn, fixtures_dir)

    counts_before = {
        table: conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        for table in ("files", "symbols", "calls", "imports")
    }

    index_directory(conn, fixtures_dir)

    counts_after = {
        table: conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        for table in ("files", "symbols", "calls", "imports")
    }
    conn.close()

    assert counts_after == counts_before
