"""文件树与文件内容测试（循环 7-8）。

覆盖：
- GET /api/files/tree 已索引 / 空库
- GET /api/files/{path} 文件内容 + 符号大纲
- 路径穿越拒绝（安全硬规则 2）
- 不存在文件 404、路径指向目录 4xx
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from code_archmage.server.app import create_app


class TestFileTree:
    """循环 7：文件树。"""

    def test_tree_after_index(self, tmp_path: Path) -> None:
        """索引后查文件树 → 返回已索引的 .py 路径列表。"""
        (tmp_path / "a.py").write_bytes(b"def foo():\n    pass\n")
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "b.py").write_bytes(b"def bar():\n    pass\n")
        app = create_app(tmp_path)
        client = TestClient(app)
        client.post("/api/index")

        resp = client.get("/api/files/tree")
        assert resp.status_code == 200
        paths = resp.json()["paths"]
        assert "a.py" in paths
        assert "src/b.py" in paths

    def test_tree_empty_db(self, tmp_path: Path) -> None:
        """空库 → 空列表（O-4 边界）。"""
        app = create_app(tmp_path)
        client = TestClient(app)
        resp = client.get("/api/files/tree")
        assert resp.status_code == 200
        assert resp.json()["paths"] == []


class TestFileContent:
    """循环 8：文件内容 + 符号大纲 + 错误路径。"""

    def test_file_content_with_symbols(self, tmp_path: Path) -> None:
        """正常文件 → 200，含 content + symbols。"""
        (tmp_path / "a.py").write_bytes(b"def foo():\n    pass\n")
        app = create_app(tmp_path)
        client = TestClient(app)
        client.post("/api/index")

        resp = client.get("/api/files/a.py")
        assert resp.status_code == 200
        data = resp.json()
        assert data["path"] == "a.py"
        assert "def foo()" in data["content"]
        assert data["language"] == "python"
        assert len(data["symbols"]) == 1
        assert data["symbols"][0]["name"] == "foo"

    def test_file_not_found(self, tmp_path: Path) -> None:
        """不存在的文件 → 404。"""
        app = create_app(tmp_path)
        client = TestClient(app)
        resp = client.get("/api/files/nonexistent.py")
        assert resp.status_code == 404

    def test_path_is_directory(self, tmp_path: Path) -> None:
        """路径指向目录 → 400。"""
        (tmp_path / "pkg").mkdir()
        app = create_app(tmp_path)
        client = TestClient(app)
        resp = client.get("/api/files/pkg")
        assert resp.status_code == 400

    def test_symlink_escape_rejected(
        self, tmp_path: Path, tmp_path_factory: pytest.TempPathFactory
    ) -> None:
        """仓库内 symlink 指向外部 → 403（安全硬规则 3，路由层）。"""
        outside = tmp_path_factory.mktemp("outside_fc")
        (outside / "secret.py").write_bytes(b"SECRET = 1\n")
        (tmp_path / "leak.py").symlink_to(outside / "secret.py")

        app = create_app(tmp_path)
        client = TestClient(app)
        resp = client.get("/api/files/leak.py")
        assert resp.status_code == 403

    def test_non_utf8_file_no_500(self, tmp_path: Path) -> None:
        """cc S-1/O-4：非 UTF-8 文件 → 200（errors=replace），不裸 500。"""
        (tmp_path / "latin.py").write_bytes(b"# caf\xe9\nx = 1\n")
        app = create_app(tmp_path)
        client = TestClient(app)
        resp = client.get("/api/files/latin.py")
        assert resp.status_code == 200
        assert "x = 1" in resp.json()["content"]
