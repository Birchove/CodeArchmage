"""tests/unit/test_llm_summaries.py – 循环 8：惰性摘要缓存。"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from code_archmage.llm.config import LLMConfig
from code_archmage.llm.summaries import SummaryResult, get_or_create

_CFG = LLMConfig(api_key="sk-test", base_url="https://x.com/v1", model="m1")


def _make_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE files (path TEXT PRIMARY KEY, hash TEXT NOT NULL, indexed_at TEXT NOT NULL);
        CREATE TABLE symbols (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, kind TEXT NOT NULL,
            file_path TEXT NOT NULL, line INTEGER NOT NULL, col INTEGER NOT NULL,
            end_line INTEGER NOT NULL, signature TEXT NOT NULL,
            bases TEXT NOT NULL, decorators TEXT NOT NULL
        );
        CREATE TABLE calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            caller_id INTEGER, callee_name TEXT NOT NULL,
            callee_id INTEGER, file_path TEXT NOT NULL,
            line INTEGER NOT NULL, col INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS summaries (
            symbol_id    INTEGER PRIMARY KEY,
            summary_text TEXT NOT NULL,
            model        TEXT NOT NULL,
            created_at   TEXT NOT NULL,
            FOREIGN KEY (symbol_id) REFERENCES symbols(id)
        );
    """)
    return conn


def _insert_symbol(conn: sqlite3.Connection, name: str = "foo") -> int:
    cur = conn.execute(
        "INSERT INTO symbols(name,kind,file_path,line,col,end_line,signature,bases,decorators) "
        "VALUES (?,?,?,1,0,5,'','[]','[]')",
        (name, "function", "src/a.py"),
    )
    conn.commit()
    return cur.lastrowid  # type: ignore[return-value]


class TestGetOrCreate:
    def test_cache_hit_returns_cached(self, tmp_path: Path) -> None:
        conn = _make_conn()
        sid = _insert_symbol(conn, "bar")
        # 预先写入缓存
        conn.execute(
            "INSERT INTO summaries(symbol_id, summary_text, model, created_at) "
            "VALUES (?,?,?,datetime('now'))",
            (sid, "缓存摘要", "old-model"),
        )
        conn.commit()

        result = get_or_create(conn, sid, _CFG, repo_root=tmp_path)
        assert result.summary_text == "缓存摘要"
        assert result.cached is True

    def test_cache_miss_calls_llm_and_stores(self, tmp_path: Path) -> None:
        conn = _make_conn()
        # 需要有源文件才能组装上下文（否则占位符）
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "a.py").write_text("def foo(): pass\n")
        sid = _insert_symbol(conn, "foo")

        with patch("code_archmage.llm.summaries.chat") as mock_chat:
            mock_chat.return_value = "这是 foo 函数的摘要。"
            result = get_or_create(conn, sid, _CFG, repo_root=tmp_path)

        assert result.summary_text == "这是 foo 函数的摘要。"
        assert result.cached is False
        assert result.model == "m1"
        # 验证已写入 DB
        row = conn.execute(
            "SELECT summary_text FROM summaries WHERE symbol_id = ?", (sid,)
        ).fetchone()
        assert row is not None
        assert row[0] == "这是 foo 函数的摘要。"

    def test_cache_miss_does_not_call_llm_again_on_second_call(
        self, tmp_path: Path
    ) -> None:
        conn = _make_conn()
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "a.py").write_text("def foo(): pass\n")
        sid = _insert_symbol(conn, "foo")

        with patch("code_archmage.llm.summaries.chat") as mock_chat:
            mock_chat.return_value = "摘要 A"
            get_or_create(conn, sid, _CFG, repo_root=tmp_path)
            get_or_create(conn, sid, _CFG, repo_root=tmp_path)

        mock_chat.assert_called_once()  # 只调了一次

    def test_model_field_recorded(self, tmp_path: Path) -> None:
        conn = _make_conn()
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "a.py").write_text("def foo(): pass\n")
        sid = _insert_symbol(conn, "foo")

        with patch("code_archmage.llm.summaries.chat") as mock_chat:
            mock_chat.return_value = "摘要"
            result = get_or_create(conn, sid, _CFG, repo_root=tmp_path)

        assert result.model == "m1"
        row = conn.execute(
            "SELECT model FROM summaries WHERE symbol_id = ?", (sid,)
        ).fetchone()
        assert row[0] == "m1"
