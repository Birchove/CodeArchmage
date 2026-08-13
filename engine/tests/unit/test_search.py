"""全文搜索测试（循环 11）。

覆盖：
- GET /api/search?q= → 200 list[SearchHitOut]
- limit 截断
- 空 q → 400
- 无匹配 → 空列表
"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from code_archmage.server.app import create_app


class TestSearch:
    """循环 11：全文搜索 + limit + 空结果。"""

    def test_search_returns_hits(self, tmp_path: Path) -> None:
        """搜索存在的符号名 → 200，返回 SearchHitOut。"""
        (tmp_path / "a.py").write_bytes(b"def alpha():\n    pass\n\ndef beta():\n    pass\n")
        app = create_app(tmp_path)
        client = TestClient(app)
        client.post("/api/index")

        resp = client.get("/api/search", params={"q": "alpha"})
        assert resp.status_code == 200
        hits = resp.json()
        assert len(hits) == 1
        assert hits[0]["name"] == "alpha"
        assert hits[0]["symbol_id"] > 0
        assert "file_path" in hits[0]

    def test_search_limit(self, tmp_path: Path) -> None:
        """limit 截断搜索结果（O-1）。"""
        (tmp_path / "a.py").write_bytes(b"def helper():\n    pass\n")
        (tmp_path / "b.py").write_bytes(b"def helper():\n    pass\n")
        (tmp_path / "c.py").write_bytes(b"def helper():\n    pass\n")
        app = create_app(tmp_path)
        client = TestClient(app)
        client.post("/api/index")

        resp = client.get("/api/search", params={"q": "helper", "limit": 2})
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_search_empty_query_returns_400(self, tmp_path: Path) -> None:
        """空 q → 400。"""
        app = create_app(tmp_path)
        client = TestClient(app)
        resp = client.get("/api/search", params={"q": ""})
        assert resp.status_code == 400

    def test_search_no_match(self, tmp_path: Path) -> None:
        """无匹配 → 空列表。"""
        (tmp_path / "a.py").write_bytes(b"def foo():\n    pass\n")
        app = create_app(tmp_path)
        client = TestClient(app)
        client.post("/api/index")

        resp = client.get("/api/search", params={"q": "nonexistent"})
        assert resp.status_code == 200
        assert resp.json() == []


class TestSearchLimitValidation:
    """cc S-2/O-3：limit 边界值校验（防负数绕过截断保护）。"""

    def test_limit_zero_returns_422(self, tmp_path: Path) -> None:
        """limit=0 → 422。"""
        app = create_app(tmp_path)
        client = TestClient(app)
        resp = client.get("/api/search", params={"q": "x", "limit": 0})
        assert resp.status_code == 422

    def test_limit_negative_returns_422(self, tmp_path: Path) -> None:
        """limit=-1 → 422（防负数绕过，cc S-2）。"""
        app = create_app(tmp_path)
        client = TestClient(app)
        resp = client.get("/api/search", params={"q": "x", "limit": -1})
        assert resp.status_code == 422

    def test_limit_over_max_returns_422(self, tmp_path: Path) -> None:
        """limit=501 → 422（上限 500，cc B-3）。"""
        app = create_app(tmp_path)
        client = TestClient(app)
        resp = client.get("/api/search", params={"q": "x", "limit": 501})
        assert resp.status_code == 422
