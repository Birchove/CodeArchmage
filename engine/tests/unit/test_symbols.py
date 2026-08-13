"""符号详情与关系查询测试（循环 9-10）。

覆盖：
- GET /api/symbols/{id} 符号详情（含 bases/decorators）
- GET /api/symbols?name= 按名查定义
- 不存在 id → 404
- GET /api/symbols/{id}/references 引用列表 + limit
- GET /api/symbols/{id}/callers 调用者
- GET /api/symbols/{id}/callees 被调用者
"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from code_archmage.server.app import create_app


def _setup_repo(tmp_path: Path) -> None:
    """造一个含类、继承、方法、跨文件调用的测试仓库。"""
    (tmp_path / "animals.py").write_bytes(
        b"class Animal:\n"
        b"    def speak(self):\n"
        b"        pass\n"
        b"\n"
        b"class Dog(Animal):\n"
        b"    @staticmethod\n"
        b"    def bark():\n"
        b"        return Animal.speak()\n"
    )
    (tmp_path / "main.py").write_bytes(
        b"from animals import Dog\n\ndef make_dog():\n    d = Dog()\n    d.bark()\n    return d\n"
    )


class TestSymbolDetail:
    """循环 9：符号详情 + 按名查定义。"""

    def test_get_symbol_by_id(self, tmp_path: Path) -> None:
        """GET /api/symbols/{id} → 200 SymbolOut（含 bases/decorators）。"""
        _setup_repo(tmp_path)
        app = create_app(tmp_path)
        client = TestClient(app)
        client.post("/api/index")

        # 先按名查拿到 Dog 的 id
        resp = client.get("/api/symbols", params={"name": "Dog"})
        assert resp.status_code == 200
        dog_id = resp.json()[0]["id"]

        # 再按 id 查
        resp = client.get(f"/api/symbols/{dog_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Dog"
        assert data["kind"] == "class"
        assert data["bases"] == ["Animal"]

    def test_get_symbol_with_decorators(self, tmp_path: Path) -> None:
        """bark 方法带 @staticmethod → decorators 含 'staticmethod'。"""
        _setup_repo(tmp_path)
        app = create_app(tmp_path)
        client = TestClient(app)
        client.post("/api/index")

        resp = client.get("/api/symbols", params={"name": "bark"})
        bark_id = resp.json()[0]["id"]

        resp = client.get(f"/api/symbols/{bark_id}")
        assert resp.status_code == 200
        assert "staticmethod" in resp.json()["decorators"]

    def test_symbol_not_found(self, tmp_path: Path) -> None:
        """不存在 id → 404。"""
        app = create_app(tmp_path)
        client = TestClient(app)
        resp = client.get("/api/symbols/99999")
        assert resp.status_code == 404

    def test_search_by_name(self, tmp_path: Path) -> None:
        """GET /api/symbols?name=Animal → 200 list[SymbolOut]。"""
        _setup_repo(tmp_path)
        app = create_app(tmp_path)
        client = TestClient(app)
        client.post("/api/index")

        resp = client.get("/api/symbols", params={"name": "Animal"})
        assert resp.status_code == 200
        symbols = resp.json()
        assert len(symbols) == 1
        assert symbols[0]["name"] == "Animal"

    def test_search_by_name_no_match(self, tmp_path: Path) -> None:
        """无匹配 → 空列表。"""
        _setup_repo(tmp_path)
        app = create_app(tmp_path)
        client = TestClient(app)
        client.post("/api/index")

        resp = client.get("/api/symbols", params={"name": "Nonexistent"})
        assert resp.status_code == 200
        assert resp.json() == []


class TestSymbolRelations:
    """循环 10：引用 + 调用者 + 被调用者 + limit。"""

    def test_references_includes_import_and_call(self, tmp_path: Path) -> None:
        """Dog 的 references 含 import（main.py 导入）和 call（make_dog 调用）。"""
        _setup_repo(tmp_path)
        app = create_app(tmp_path)
        client = TestClient(app)
        client.post("/api/index")

        dog_id = client.get("/api/symbols", params={"name": "Dog"}).json()[0]["id"]
        resp = client.get(f"/api/symbols/{dog_id}/references")
        assert resp.status_code == 200
        kinds = {r["kind"] for r in resp.json()}
        assert "import" in kinds

    def test_callers(self, tmp_path: Path) -> None:
        """bark 的 callers → make_dog（d.bark() 在 make_dog 内）。"""
        _setup_repo(tmp_path)
        app = create_app(tmp_path)
        client = TestClient(app)
        client.post("/api/index")

        bark_id = client.get("/api/symbols", params={"name": "bark"}).json()[0]["id"]
        resp = client.get(f"/api/symbols/{bark_id}/callers")
        assert resp.status_code == 200
        caller_names = {c["name"] for c in resp.json()}
        assert "make_dog" in caller_names

    def test_callees(self, tmp_path: Path) -> None:
        """make_dog 的 callees → 含 Dog 和 bark。"""
        _setup_repo(tmp_path)
        app = create_app(tmp_path)
        client = TestClient(app)
        client.post("/api/index")

        make_dog_id = client.get("/api/symbols", params={"name": "make_dog"}).json()[0]["id"]
        resp = client.get(f"/api/symbols/{make_dog_id}/callees")
        assert resp.status_code == 200
        callee_names = {c["name"] for c in resp.json()}
        assert "Dog" in callee_names
        assert "bark" in callee_names

    def test_references_limit(self, tmp_path: Path) -> None:
        """limit 截断引用列表（O-1 大结果集保护）。"""
        (tmp_path / "many.py").write_bytes(
            b"def foo():\n    pass\n\n"
            b"def caller():\n"
            b"    foo()\n    foo()\n    foo()\n    foo()\n    foo()\n"
        )
        app = create_app(tmp_path)
        client = TestClient(app)
        client.post("/api/index")

        foo_id = client.get("/api/symbols", params={"name": "foo"}).json()[0]["id"]
        resp = client.get(f"/api/symbols/{foo_id}/references", params={"limit": 3})
        assert resp.status_code == 200
        assert len(resp.json()) == 3

    def test_relations_for_unknown_symbol(self, tmp_path: Path) -> None:
        """不存在 id 的关系查询 → 空列表（不报错）。"""
        app = create_app(tmp_path)
        client = TestClient(app)
        for rel in ("references", "callers", "callees"):
            resp = client.get(f"/api/symbols/99999/{rel}")
            assert resp.status_code == 200
            assert resp.json() == []
