"""应用工厂与启动测试（循环 4）。

覆盖：
- create_app 返回 FastAPI 实例
- 首次启动自动建 db 目录（B-4）
- health 端点
- CORS 开发模式注册 / 生产模式不注册（B-7）
- run_server 默认绑定 127.0.0.1:8765，0.0.0.0 强制改回（安全硬规则 1）
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from code_archmage.server.app import create_app, run_server


class TestCreateApp:
    """应用工厂基础。"""

    def test_returns_fastapi_instance(self, tmp_path: Path) -> None:
        app = create_app(tmp_path)
        assert isinstance(app, FastAPI)

    def test_makes_db_dir_on_first_start(self, tmp_path: Path) -> None:
        """全新仓库无 .code_archmage_index/ → create_app 自动创建（B-4）。"""
        db_path = tmp_path / ".code_archmage_index" / "index.sqlite"
        assert not db_path.parent.exists()
        create_app(tmp_path, db_path=db_path)
        assert db_path.parent.exists()

    def test_state_holds_repo_root_and_db_path(self, tmp_path: Path) -> None:
        db_path = tmp_path / "index.sqlite"
        app = create_app(tmp_path, db_path=db_path)
        assert app.state.repo_root == tmp_path.resolve() or app.state.repo_root == tmp_path
        assert app.state.db_path == db_path

    def test_health_endpoint(self, tmp_path: Path) -> None:
        app = create_app(tmp_path)
        client = TestClient(app)
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


class TestCors:
    """CORS 中间件（B-7）。"""

    def test_dev_mode_allows_localhost_5173(self, tmp_path: Path) -> None:
        """dev_mode 下允许 http://localhost:5173（Vite 默认端口）。"""
        app = create_app(tmp_path, dev_mode=True)
        client = TestClient(app)
        resp = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == "http://localhost:5173"

    def test_prod_mode_no_cors_header(self, tmp_path: Path) -> None:
        """生产模式不注册 CORS → 无 access-control-allow-origin。"""
        app = create_app(tmp_path, dev_mode=False)
        client = TestClient(app)
        resp = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
        assert resp.status_code == 200
        assert "access-control-allow-origin" not in resp.headers


class TestRunServer:
    """启动函数参数（安全硬规则 1）。"""

    def test_default_host_is_loopback(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """run_server 默认 host=127.0.0.1, port=8765。"""
        captured: dict[str, object] = {}

        def fake_run(app: object, **kwargs: object) -> None:
            captured.update(kwargs)

        monkeypatch.setattr("code_archmage.server.app.uvicorn.run", fake_run)
        run_server(tmp_path)
        assert captured["host"] == "127.0.0.1"
        assert captured["port"] == 8765

    def test_wildcard_host_forced_to_loopback(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """传 host=0.0.0.0 → 强制改回 127.0.0.1（安全硬规则 1）。"""
        captured: dict[str, object] = {}

        def fake_run(app: object, **kwargs: object) -> None:
            captured.update(kwargs)

        monkeypatch.setattr("code_archmage.server.app.uvicorn.run", fake_run)
        run_server(tmp_path, host="0.0.0.0")
        assert captured["host"] == "127.0.0.1"


class TestDbUnavailable:
    """cc O-1：OperationalError → 503 测试固化。"""

    def test_db_locked_returns_503(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """数据库 locked/busy → 503，不裸 500（B-8）。"""
        import sqlite3

        # 先 create_app（init_db 正常执行），再 monkeypatch（sqlite3 是全局单例）
        app = create_app(tmp_path)

        def fake_connect(*args: object, **kwargs: object) -> sqlite3.Connection:
            raise sqlite3.OperationalError("database is locked")

        monkeypatch.setattr("code_archmage.server.routes.sqlite3.connect", fake_connect)
        client = TestClient(app)
        resp = client.get("/api/index/status")
        assert resp.status_code == 503
