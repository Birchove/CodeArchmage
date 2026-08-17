"""tests/unit/test_llm_routes.py – 循环 9：LLM API 端点接线。

测试：
- GET  /api/llm/config → configured true/false
- POST /api/chat → 流式 SSE（mock gateway）
- GET  /api/summaries/{id} → 缓存命中/404
- POST /api/summaries → 生成摘要
- 未配置 LLM 时所有端点返回 503
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from code_archmage.llm.config import LLMConfig
from code_archmage.server.app import create_app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_CFG = LLMConfig(api_key="sk-test", base_url="https://x.com/v1", model="m1")


@pytest.fixture
def tmp_repo(tmp_path: Path) -> Path:
    src = tmp_path / "src"
    src.mkdir()
    (src / "a.py").write_text("def foo(): pass\n")
    return tmp_path


@pytest.fixture
def client_with_llm(tmp_repo: Path) -> TestClient:
    app = create_app(tmp_repo, dev_mode=False, llm_config=_CFG)
    # 初始化测试用的 schema（包含 summaries 表）
    conn = sqlite3.connect(str(tmp_repo / ".code_archmage_index" / "index.sqlite"))
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        INSERT OR IGNORE INTO files(path, hash, indexed_at) VALUES ('src/a.py','h1','2024-01-01');
        INSERT OR IGNORE INTO symbols(id,name,kind,file_path,line,col,end_line,signature,bases,decorators)
        VALUES (1,'foo','function','src/a.py',1,0,1,'def foo():','[]','[]');
    """)
    conn.close()
    return TestClient(app)


@pytest.fixture
def client_no_llm(tmp_repo: Path) -> TestClient:
    app = create_app(tmp_repo, dev_mode=False, llm_config=None)
    return TestClient(app)


# ---------------------------------------------------------------------------
# GET /api/llm/config
# ---------------------------------------------------------------------------


class TestLLMConfigEndpoint:
    def test_configured_true_when_llm_set(self, client_with_llm: TestClient) -> None:
        resp = client_with_llm.get("/api/llm/config")
        assert resp.status_code == 200
        data = resp.json()
        assert data["configured"] is True
        assert data["model"] == "m1"

    def test_no_api_key_in_response(self, client_with_llm: TestClient) -> None:
        resp = client_with_llm.get("/api/llm/config")
        body_str = resp.text
        assert "sk-test" not in body_str

    def test_configured_false_when_no_llm(self, client_no_llm: TestClient) -> None:
        resp = client_no_llm.get("/api/llm/config")
        assert resp.status_code == 200
        assert resp.json()["configured"] is False


# ---------------------------------------------------------------------------
# POST /api/chat → SSE
# ---------------------------------------------------------------------------


class TestChatEndpoint:
    def test_returns_sse_stream(self, client_with_llm: TestClient) -> None:
        with patch("code_archmage.server.llm_routes.chat_stream") as mock_stream:
            mock_stream.return_value = iter(["你", "好"])
            resp = client_with_llm.post(
                "/api/chat",
                json={"message": "你好", "symbol_id": 1, "history": []},
            )
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers.get("content-type", "")

    def test_stream_contains_deltas(self, client_with_llm: TestClient) -> None:
        with patch("code_archmage.server.llm_routes.chat_stream") as mock_stream:
            mock_stream.return_value = iter(["hi", " there"])
            resp = client_with_llm.post(
                "/api/chat",
                json={"message": "test", "symbol_id": None, "history": []},
            )
        text = resp.text
        assert "hi" in text
        assert "there" in text

    def test_sse_has_cache_control_header(self, client_with_llm: TestClient) -> None:
        with patch("code_archmage.server.llm_routes.chat_stream") as mock_stream:
            mock_stream.return_value = iter([])
            resp = client_with_llm.post(
                "/api/chat",
                json={"message": "x", "symbol_id": None, "history": []},
            )
        assert resp.headers.get("cache-control") == "no-cache"

    def test_503_when_no_llm(self, client_no_llm: TestClient) -> None:
        resp = client_no_llm.post(
            "/api/chat",
            json={"message": "x", "symbol_id": None, "history": []},
        )
        assert resp.status_code == 503

    def test_stream_error_included_in_sse(self, client_with_llm: TestClient) -> None:
        from code_archmage.llm.gateway import GatewayError

        with patch("code_archmage.server.llm_routes.chat_stream") as mock_stream:
            mock_stream.side_effect = GatewayError("测试错误")
            resp = client_with_llm.post(
                "/api/chat",
                json={"message": "x", "symbol_id": None, "history": []},
            )
        # GatewayError 被 _stream_chat 捕获后以 SSE 行内嵌返回，HTTP 仍为 200
        assert resp.status_code == 200
        assert "测试错误" in resp.text
        assert "[DONE]" in resp.text


# ---------------------------------------------------------------------------
# GET /api/summaries/{symbol_id}
# ---------------------------------------------------------------------------


class TestSummariesGet:
    def test_404_when_no_summary(self, client_with_llm: TestClient) -> None:
        resp = client_with_llm.get("/api/summaries/1")
        assert resp.status_code == 404

    def test_200_when_cached(self, client_with_llm: TestClient, tmp_repo: Path) -> None:
        db_path = tmp_repo / ".code_archmage_index" / "index.sqlite"
        conn = sqlite3.connect(str(db_path))
        conn.execute(
            "INSERT INTO summaries(symbol_id,summary_text,model,created_at) VALUES (1,'测试摘要','m1',datetime('now'))"
        )
        conn.commit()
        conn.close()
        resp = client_with_llm.get("/api/summaries/1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["summary_text"] == "测试摘要"
        assert data["cached"] is True

    def test_503_when_no_llm(self, client_no_llm: TestClient) -> None:
        resp = client_no_llm.get("/api/summaries/1")
        assert resp.status_code == 503


# ---------------------------------------------------------------------------
# POST /api/summaries
# ---------------------------------------------------------------------------


class TestSummariesPost:
    def test_generates_summary(self, client_with_llm: TestClient) -> None:
        with patch("code_archmage.server.llm_routes.get_or_create") as mock_get:
            from code_archmage.llm.summaries import SummaryResult

            mock_get.return_value = SummaryResult(
                symbol_id=1, summary_text="生成的摘要", model="m1", cached=False
            )
            resp = client_with_llm.post("/api/summaries", json={"symbol_id": 1})
        assert resp.status_code == 200
        data = resp.json()
        assert data["summary_text"] == "生成的摘要"
        assert data["cached"] is False

    def test_503_when_no_llm(self, client_no_llm: TestClient) -> None:
        resp = client_no_llm.post("/api/summaries", json={"symbol_id": 1})
        assert resp.status_code == 503
