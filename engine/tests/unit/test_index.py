"""索引触发与状态测试（循环 5-6）。

覆盖：
- POST /api/index 索引有文件的仓库 → 200 IndexResultOut（计数 > 0）
- 空仓库（无 .py）→ 200 全零
- 并发互斥：锁被占时第二个请求 409（B-1）
- GET /api/index/status 已索引 / 空库
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from code_archmage.server.app import create_app


class TestTriggerIndex:
    """循环 5：索引触发 + 并发互斥 + 空仓库。"""

    def test_index_populated_repo(self, tmp_path: Path) -> None:
        """索引有文件的仓库 → 200，计数 > 0。"""
        (tmp_path / "a.py").write_bytes(b"def foo():\n    pass\n")
        (tmp_path / "b.py").write_bytes(b"def bar():\n    pass\n")

        app = create_app(tmp_path)
        client = TestClient(app)
        resp = client.post("/api/index")

        assert resp.status_code == 200
        data = resp.json()
        assert data["files_total"] == 2
        assert data["symbols_total"] == 2
        assert data["calls_total"] == 0
        assert data["duration_ms"] >= 0
        # cc B-1: files_changed 已移除（原恒等于 files_total，语义误导）
        assert "files_changed" not in data
        # Stage 7a A-5：索引统计（首次全量 → 全部重新索引）
        assert data["files_updated"] == 2
        assert data["files_skipped"] == 0

    def test_reindex_reports_skipped(self, tmp_path: Path) -> None:
        """Stage 7a A-5：二次索引（无改动）→ skipped=全部。"""
        (tmp_path / "a.py").write_bytes(b"def foo():\n    pass\n")
        (tmp_path / "b.py").write_bytes(b"def bar():\n    pass\n")

        app = create_app(tmp_path)
        client = TestClient(app)
        client.post("/api/index")
        resp = client.post("/api/index")

        assert resp.status_code == 200
        data = resp.json()
        assert data["files_updated"] == 0
        assert data["files_skipped"] == 2

    def test_index_empty_repo(self, tmp_path: Path) -> None:
        """空仓库（无 .py）→ 200 全零。"""
        app = create_app(tmp_path)
        client = TestClient(app)
        resp = client.post("/api/index")

        assert resp.status_code == 200
        data = resp.json()
        assert data["files_total"] == 0
        assert data["symbols_total"] == 0

    def test_concurrent_index_returns_409(self, tmp_path: Path) -> None:
        """锁被占时 POST /api/index → 409（B-1 并发互斥）。"""
        (tmp_path / "a.py").write_bytes(b"def foo():\n    pass\n")
        app = create_app(tmp_path)

        # 先占住锁，模拟另一个索引正在进行
        app.state.index_lock.acquire()
        try:
            client = TestClient(app)
            resp = client.post("/api/index")
            assert resp.status_code == 409
        finally:
            app.state.index_lock.release()


class TestIndexStatus:
    """循环 6：索引状态 + 空库。"""

    def test_status_after_index(self, tmp_path: Path) -> None:
        """索引后查状态 → 计数正确。"""
        (tmp_path / "a.py").write_bytes(b"def foo():\n    pass\n")
        app = create_app(tmp_path)
        client = TestClient(app)
        client.post("/api/index")

        resp = client.get("/api/index/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["file_count"] == 1
        assert data["symbol_count"] == 1
        assert data["schema_version"] == "2"
        assert data["repo_root"] == str(app.state.repo_root)

    def test_status_empty_db(self, tmp_path: Path) -> None:
        """空库（未索引）→ file_count=0，不报错（O-4 边界）。"""
        app = create_app(tmp_path)
        client = TestClient(app)

        resp = client.get("/api/index/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["file_count"] == 0
        assert data["symbol_count"] == 0

    def test_symlink_not_indexed_via_http(
        self, tmp_path: Path, tmp_path_factory: pytest.TempPathFactory
    ) -> None:
        """cc O-2：POST /api/index（仓库含外指 symlink）→ tree 不含 symlink（HTTP 端到端）。"""
        outside = tmp_path_factory.mktemp("outside_idx")
        (outside / "secret.py").write_bytes(b"def leak():\n    pass\n")
        (tmp_path / "safe.py").write_bytes(b"def ok():\n    pass\n")
        (tmp_path / "leak.py").symlink_to(outside / "secret.py")

        app = create_app(tmp_path)
        client = TestClient(app)
        client.post("/api/index")

        resp = client.get("/api/files/tree")
        paths = resp.json()["paths"]
        assert "leak.py" not in paths
        assert "safe.py" in paths
