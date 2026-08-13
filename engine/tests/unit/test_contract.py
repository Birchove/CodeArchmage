"""OpenAPI 契约回归测试（循环 12）。

验证 FastAPI 自动生成的 /openapi.json 完整且关键端点 schema 正确。
前后端共享此契约，回归测试防止字段意外丢失（O-2）。
"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from code_archmage.server.app import create_app


class TestOpenApiContract:
    """循环 12：OpenAPI 契约回归。"""

    def test_openapi_json_accessible(self, tmp_path: Path) -> None:
        """/openapi.json 可访问且含标题。"""
        app = create_app(tmp_path)
        client = TestClient(app)
        resp = client.get("/openapi.json")
        assert resp.status_code == 200
        schema = resp.json()
        assert schema["info"]["title"] == "Code Archmage"
        assert "paths" in schema

    def test_all_endpoints_present(self, tmp_path: Path) -> None:
        """所有 11 个端点都在 OpenAPI paths 中。"""
        app = create_app(tmp_path)
        client = TestClient(app)
        paths = client.get("/openapi.json").json()["paths"]

        expected = [
            "/api/health",
            "/api/index",
            "/api/index/status",
            "/api/files/tree",
            "/api/files/{file_path}",
            "/api/symbols",
            "/api/symbols/{symbol_id}",
            "/api/symbols/{symbol_id}/references",
            "/api/symbols/{symbol_id}/callers",
            "/api/symbols/{symbol_id}/callees",
            "/api/search",
        ]
        for path in expected:
            assert path in paths, f"缺少端点：{path}"

    def test_symbol_out_schema_fields(self, tmp_path: Path) -> None:
        """SymbolOut schema 含所有字段（含 B-5 新增的 bases/decorators）。"""
        app = create_app(tmp_path)
        client = TestClient(app)
        components = client.get("/openapi.json").json()["components"]["schemas"]
        props = components["SymbolOut"]["properties"]
        for field in [
            "id",
            "name",
            "kind",
            "file_path",
            "line",
            "col",
            "end_line",
            "signature",
            "bases",
            "decorators",
        ]:
            assert field in props, f"SymbolOut 缺少字段：{field}"

    def test_docs_endpoint_accessible(self, tmp_path: Path) -> None:
        """/docs（Swagger UI）可访问。"""
        app = create_app(tmp_path)
        client = TestClient(app)
        resp = client.get("/docs")
        assert resp.status_code == 200
