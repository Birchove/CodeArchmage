"""索引器 Schema 测试：init_db 创建所有表、索引、触发器。

阶段 2 第一个 TDD 循环。用 :memory: 数据库跑，无副作用、快。
查 sqlite_master 断言结构完整。
"""

from __future__ import annotations

import sqlite3

from code_archmage.indexer.schema import init_db


class TestInitDb:
    """init_db 创建完整的索引库结构。"""

    def test_returns_connection(self) -> None:
        """init_db 返回一个可用的 sqlite3.Connection。"""
        conn = init_db(":memory:")
        assert isinstance(conn, sqlite3.Connection)
        conn.close()

    def test_all_tables_exist(self) -> None:
        """7 张业务表全部存在（FTS5 影子表和 sqlite_sequence 是内部表，用子集检查）。"""
        conn = init_db(":memory:")
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        table_names = {r[0] for r in rows}
        conn.close()

        expected = {"meta", "files", "symbols", "calls", "imports", "summaries", "symbols_fts"}
        # 子集检查：FTS5 会自动创建 symbols_fts_data/_config/_idx/_docsize 等影子表
        assert expected <= table_names, f"缺少表: {expected - table_names}"

    def test_all_indexes_exist(self) -> None:
        """7 个索引全部存在。"""
        conn = init_db(":memory:")
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
        ).fetchall()
        index_names = {r[0] for r in rows}
        conn.close()

        expected = {
            "idx_symbols_name",
            "idx_symbols_file",
            "idx_calls_caller",
            "idx_calls_callee_name",
            "idx_calls_callee_id",
            "idx_imports_file",
            "idx_imports_name",
        }
        assert index_names == expected, f"缺少索引: {expected - index_names}"

    def test_fts_triggers_exist(self) -> None:
        """3 个 FTS 同步触发器存在：symbols_ai / symbols_ad / symbols_au。"""
        conn = init_db(":memory:")
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name"
        ).fetchall()
        trigger_names = {r[0] for r in rows}
        conn.close()

        expected = {"symbols_ai", "symbols_ad", "symbols_au"}
        assert trigger_names == expected, f"缺少触发器: {expected - trigger_names}"

    def test_meta_schema_version(self) -> None:
        """meta 表写入 schema_version='1'。"""
        conn = init_db(":memory:")
        row = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
        conn.close()

        assert row is not None
        assert row[0] == "1"

    def test_wal_mode_on_file_db(self, tmp_path: object) -> None:
        """文件数据库启用 WAL 模式（:memory: 下 WAL 不适用，故单独测文件库）。"""
        from pathlib import Path

        db_path = Path(str(tmp_path)) / "test.db"
        conn = init_db(db_path)
        mode = conn.execute("PRAGMA journal_mode").fetchone()
        conn.close()

        assert mode is not None
        assert mode[0].lower() == "wal"

    def test_idempotent(self) -> None:
        """对已初始化的库再调 init_db 不报错（幂等：IF NOT EXISTS）。"""
        conn = init_db(":memory:")
        # 再次初始化不应抛异常
        init_db(":memory:", conn=conn)
        # 表依然在
        count = conn.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()
        conn.close()

        assert count is not None
        assert count[0] >= 7
