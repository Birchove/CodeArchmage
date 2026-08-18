"""guides 存储层测试（Stage 7b 循环 1）。

upsert_guide / get_guide / list_guides：按 (scope, path) 唯一的导读缓存。
"""

from __future__ import annotations

from code_archmage.indexer.schema import init_db
from code_archmage.llm.guide_store import (
    StoredGuide,
    get_guide,
    list_guides,
    upsert_guide,
)


class TestGuideStore:
    """guides 表读写。"""

    def test_get_missing_returns_none(self) -> None:
        """未生成 → None。"""
        conn = init_db(":memory:")
        assert get_guide(conn, "project", "") is None
        assert get_guide(conn, "file", "src/a.py") is None
        conn.close()

    def test_upsert_then_get(self) -> None:
        """写入后能读回全部字段。"""
        conn = init_db(":memory:")
        upsert_guide(
            conn,
            scope="module",
            path="src/parser",
            content_md="# parser\n\n讲解",
            model="test-model",
            input_hash="hash-1",
        )

        got = get_guide(conn, "module", "src/parser")
        conn.close()

        assert got is not None
        assert got == StoredGuide(
            scope="module",
            path="src/parser",
            content_md="# parser\n\n讲解",
            model="test-model",
            input_hash="hash-1",
            created_at=got.created_at,
        )
        assert got.created_at  # 时间戳非空

    def test_upsert_replaces_existing(self) -> None:
        """同 (scope, path) 重复写 → 覆盖（不报唯一约束错误）。"""
        conn = init_db(":memory:")
        upsert_guide(conn, "file", "a.py", "旧内容", "m1", "h1")
        upsert_guide(conn, "file", "a.py", "新内容", "m2", "h2")

        got = get_guide(conn, "file", "a.py")
        all_rows = list_guides(conn)
        conn.close()

        assert got is not None
        assert got.content_md == "新内容"
        assert got.input_hash == "h2"
        assert len(all_rows) == 1  # 覆盖而非追加

    def test_list_guides_all(self) -> None:
        """list_guides 返回所有导读条目。"""
        conn = init_db(":memory:")
        upsert_guide(conn, "project", "", "项目导读", "m", "h")
        upsert_guide(conn, "module", "src", "模块导读", "m", "h")
        upsert_guide(conn, "file", "src/a.py", "文件导读", "m", "h")

        rows = list_guides(conn)
        conn.close()

        keys = {(g.scope, g.path) for g in rows}
        assert keys == {("project", ""), ("module", "src"), ("file", "src/a.py")}
