"""tests/unit/test_guide_routes.py – Stage 7b 循环 4-5：导读 API。

覆盖：
- GET  /api/guides/tree → 确定性目录（不碰 LLM）
- GET  /api/guides?scope=&path= → 404 / cached / stale / blocks
- POST /api/guides/generate → SSE 生成落库 + 无效 scope/path → 404/400
- 未配置 LLM 时 generate 返回 503
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

_CFG = LLMConfig(api_key="sk-test", base_url="https://x.com/v1", model="m1")


@pytest.fixture()
def repo(tmp_path: Path) -> Path:
    (tmp_path / "main.py").write_bytes(
        b'def main():\n    pass\n\n\nif __name__ == "__main__":\n    main()\n'
    )
    pkg = tmp_path / "pkg"
    pkg.mkdir()
    (pkg / "core.py").write_bytes(b"def run():\n    return 1\n")
    return tmp_path


@pytest.fixture()
def indexed_client(repo: Path) -> TestClient:
    app = create_app(repo, llm_config=_CFG)
    client = TestClient(app)
    client.post("/api/index")
    return client


def _sse_content(resp_text: str) -> str:
    """从 generate 的 SSE 响应里提取 content 字段拼接。"""
    out = []
    for line in resp_text.splitlines():
        if line.startswith("data: ") and line != "data: [DONE]":
            payload = json.loads(line[len("data: ") :])
            if "content" in payload:
                out.append(payload["content"])
    return "".join(out)


class TestGuideTree:
    def test_tree_before_generate(self, indexed_client: TestClient) -> None:
        """全部条目 status=none（确定性，不碰 LLM）。"""
        resp = indexed_client.get("/api/guides/tree")
        assert resp.status_code == 200
        data = resp.json()

        assert data["project"]["scope"] == "project"
        assert data["project"]["path"] == ""
        assert data["project"]["status"] == "none"

        assert {m["path"] for m in data["modules"]} == {"pkg"}
        assert {f["path"] for f in data["files"]} == {"main.py", "pkg/core.py"}
        assert all(e["status"] == "none" for e in data["files"])

    def test_tree_works_without_llm(self, repo: Path) -> None:
        """tree 不需要 LLM 配置。"""
        app = create_app(repo, llm_config=None)
        client = TestClient(app)
        client.post("/api/index")
        assert client.get("/api/guides/tree").status_code == 200


class TestGuideRead:
    def test_404_when_not_generated(self, indexed_client: TestClient) -> None:
        resp = indexed_client.get("/api/guides", params={"scope": "file", "path": "main.py"})
        assert resp.status_code == 404

    def test_cached_guide_returns_blocks(self, indexed_client: TestClient, repo: Path) -> None:
        """写入一条导读 → GET 返回解析后的 blocks + stale 判断。"""
        # 算出当前上下文的 hash，写入一条"新鲜"导读
        from code_archmage.llm import guides as g

        db_path = repo / ".code_archmage_index" / "index.sqlite"
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        ctx = g._build_context(conn, repo, "file", "main.py")
        input_hash = g._context_hash(ctx)
        md = "讲解。\n\n```code file=main.py lines=1-2\n```\n\n结尾。"
        g.upsert_guide(conn, "file", "main.py", md, "m1", input_hash)
        conn.close()

        resp = indexed_client.get("/api/guides", params={"scope": "file", "path": "main.py"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["stale"] is False
        types = [b["type"] for b in data["blocks"]]
        assert types == ["text", "code", "text"]
        code_block = data["blocks"][1]
        assert code_block["file_path"] == "main.py"
        assert code_block["start_line"] == 1
        assert code_block["end_line"] == 2

    def test_stale_flag_when_context_changed(self, indexed_client: TestClient, repo: Path) -> None:
        """input_hash 与当前上下文不一致 → stale=true。"""
        from code_archmage.llm import guides as g

        db_path = repo / ".code_archmage_index" / "index.sqlite"
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        g.upsert_guide(conn, "file", "main.py", "旧导读", "m1", "old-hash")
        conn.close()

        data = indexed_client.get("/api/guides", params={"scope": "file", "path": "main.py"}).json()
        assert data["stale"] is True

    def test_invalid_scope_400(self, indexed_client: TestClient) -> None:
        resp = indexed_client.get("/api/guides", params={"scope": "nope", "path": ""})
        assert resp.status_code == 400


class TestGuideGenerate:
    def test_generate_streams_and_persists(self, indexed_client: TestClient) -> None:
        """mock LLM 流式 → SSE 200 + 落库（再 GET 能读到）。"""
        md = "# 导读\n\n讲解文字。\n"
        with patch("code_archmage.llm.guides.chat_stream") as mock_stream:
            mock_stream.return_value = iter([md[:5], md[5:]])
            resp = indexed_client.post(
                "/api/guides/generate",
                json={"scope": "file", "path": "main.py"},
            )
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers.get("content-type", "")
        assert "[DONE]" in resp.text
        assert _sse_content(resp.text) == md

        # 落库：再 GET 读到
        data = indexed_client.get("/api/guides", params={"scope": "file", "path": "main.py"}).json()
        assert data["content_md"] == md
        assert data["model"] == "m1"

    def test_generate_project_scope(self, indexed_client: TestClient) -> None:
        with patch("code_archmage.llm.guides.chat_stream") as mock_stream:
            mock_stream.return_value = iter(["项目导读"])
            resp = indexed_client.post(
                "/api/guides/generate", json={"scope": "project", "path": ""}
            )
        assert resp.status_code == 200

    def test_generate_unknown_file_404(self, indexed_client: TestClient) -> None:
        resp = indexed_client.post(
            "/api/guides/generate", json={"scope": "file", "path": "ghost.py"}
        )
        assert resp.status_code == 404

    def test_generate_invalid_scope_400(self, indexed_client: TestClient) -> None:
        resp = indexed_client.post("/api/guides/generate", json={"scope": "weird", "path": ""})
        assert resp.status_code == 400

    def test_generate_503_when_no_llm(self, repo: Path) -> None:
        app = create_app(repo, llm_config=None)
        client = TestClient(app)
        client.post("/api/index")
        resp = client.post("/api/guides/generate", json={"scope": "project", "path": ""})
        assert resp.status_code == 503

    def test_generate_empty_context_400(self, tmp_path: Path) -> None:
        """空仓库生成项目导读 → 400（没东西可讲，不浪费 token）。"""
        app = create_app(tmp_path, llm_config=_CFG)
        client = TestClient(app)
        client.post("/api/index")
        resp = client.post("/api/guides/generate", json={"scope": "project", "path": ""})
        assert resp.status_code == 400
