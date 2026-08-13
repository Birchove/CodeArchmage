"""服务层全链路集成测试（循环 13）。

完整流程：索引 → 文件树 → 文件内容 → 符号详情 → 调用关系。
验证各端点组装正确，无新代码。
"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from code_archmage.server.app import create_app


class TestServerFlow:
    """循环 13：全链路集成。"""

    def test_full_flow_index_tree_content_symbol_callers(self, tmp_path: Path) -> None:
        """完整流程：索引→文件树→文件内容→符号详情→调用者。"""
        # 造一个有调用关系的仓库
        (tmp_path / "models.py").write_bytes(
            b"class User:\n"
            b"    def __init__(self, name):\n"
            b"        self.name = name\n"
            b"\n"
            b"    def greet(self):\n"
            b"        return f'Hello {self.name}'\n"
        )
        (tmp_path / "service.py").write_bytes(
            b"from models import User\n"
            b"\n"
            b"def create_user(name):\n"
            b"    user = User(name)\n"
            b"    return user.greet()\n"
        )

        app = create_app(tmp_path)
        client = TestClient(app)

        # 1. 索引
        resp = client.post("/api/index")
        assert resp.status_code == 200
        assert resp.json()["files_total"] == 2

        # 2. 文件树
        resp = client.get("/api/files/tree")
        assert resp.status_code == 200
        paths = resp.json()["paths"]
        assert "models.py" in paths
        assert "service.py" in paths

        # 3. 文件内容 + 符号大纲
        resp = client.get("/api/files/service.py")
        assert resp.status_code == 200
        content_data = resp.json()
        assert "create_user" in content_data["content"]
        symbol_names = {s["name"] for s in content_data["symbols"]}
        assert "create_user" in symbol_names

        # 4. 符号详情（按名查拿 id，再查详情）
        resp = client.get("/api/symbols", params={"name": "greet"})
        assert resp.status_code == 200
        greet_id = resp.json()[0]["id"]

        resp = client.get(f"/api/symbols/{greet_id}")
        assert resp.status_code == 200
        assert resp.json()["name"] == "greet"

        # 5. 调用者（create_user 调用了 greet）
        resp = client.get(f"/api/symbols/{greet_id}/callers")
        assert resp.status_code == 200
        caller_names = {c["name"] for c in resp.json()}
        assert "create_user" in caller_names

    def test_full_flow_search_and_callees(self, tmp_path: Path) -> None:
        """完整流程：搜索 → 被调用者。"""
        (tmp_path / "core.py").write_bytes(
            b"def process(data):\n"
            b"    cleaned = clean(data)\n"
            b"    return validate(cleaned)\n"
            b"\n"
            b"def clean(data):\n"
            b"    return data.strip()\n"
            b"\n"
            b"def validate(data):\n"
            b"    return len(data) > 0\n"
        )

        app = create_app(tmp_path)
        client = TestClient(app)
        client.post("/api/index")

        # 搜索 process
        resp = client.get("/api/search", params={"q": "process"})
        assert resp.status_code == 200
        hits = resp.json()
        assert len(hits) == 1
        process_id = hits[0]["symbol_id"]

        # 查 process 的被调用者 → clean, validate
        resp = client.get(f"/api/symbols/{process_id}/callees")
        assert resp.status_code == 200
        callee_names = {c["name"] for c in resp.json()}
        assert "clean" in callee_names
        assert "validate" in callee_names
