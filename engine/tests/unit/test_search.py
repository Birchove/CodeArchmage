"""索引器 FTS5 全文搜索测试。

阶段 2 第九个 TDD 循环。索引 fixtures 后跑 FTS5 搜索。
"""

from __future__ import annotations

from pathlib import Path

from code_archmage.indexer.resolver import assign_callers, resolve_callees
from code_archmage.indexer.schema import init_db
from code_archmage.indexer.search import search_fts
from code_archmage.indexer.writer import index_directory
from code_archmage.parser.models import Symbol


def _index_fixtures(conn, fixtures_dir: Path) -> None:
    """索引 fixtures（测试辅助）。"""
    index_directory(conn, fixtures_dir)
    assign_callers(conn)
    resolve_callees(conn)


class TestSearchFts:
    """循环 9：FTS5 全文搜索。"""

    def test_search_by_name(self, fixtures_dir: Path) -> None:
        """按符号名搜索 → 返回匹配的符号。"""
        conn = init_db(":memory:")
        _index_fixtures(conn, fixtures_dir)

        results = search_fts(conn, "foo")
        conn.close()

        assert len(results) >= 1
        assert all(isinstance(r, Symbol) for r in results)
        # foo 定义在 simple_function.py
        names = {r.name for r in results}
        assert "foo" in names

    def test_search_class_name(self, fixtures_dir: Path) -> None:
        """搜索类名 → 返回类符号。"""
        conn = init_db(":memory:")
        _index_fixtures(conn, fixtures_dir)

        results = search_fts(conn, "Dog")
        conn.close()

        assert len(results) == 1
        assert results[0].name == "Dog"

    def test_search_nonexistent(self, fixtures_dir: Path) -> None:
        """搜索不存在的名称 → 返回空列表。"""
        conn = init_db(":memory:")
        _index_fixtures(conn, fixtures_dir)

        results = search_fts(conn, "zzz不存在")
        conn.close()

        assert results == []

    def test_search_special_chars_no_crash(self, fixtures_dir: Path) -> None:
        """特殊字符不崩溃（FTS5 特殊字符被转义）。"""
        conn = init_db(":memory:")
        _index_fixtures(conn, fixtures_dir)

        # 这些 FTS5 特殊字符不应导致崩溃
        results = search_fts(conn, "foo() bar*")
        conn.close()

        # 不崩溃即可（结果可能为空或非空，取决于分词）
        assert isinstance(results, list)

    def test_fts_rebuild(self, fixtures_dir: Path) -> None:
        """FTS rebuild 命令后搜索结果不变。"""
        conn = init_db(":memory:")
        _index_fixtures(conn, fixtures_dir)

        before = search_fts(conn, "foo")

        # 重建 FTS 索引
        conn.execute("INSERT INTO symbols_fts(symbols_fts) VALUES('rebuild')")

        after = search_fts(conn, "foo")
        conn.close()

        assert len(before) == len(after)
        assert {r.name for r in before} == {r.name for r in after}
