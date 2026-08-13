"""FastAPI 应用工厂与启动。

安全硬规则 1：run_server 只绑定 127.0.0.1，传 0.0.0.0 强制改回。
连接策略遵循 ADR-002：每请求在工作线程内开/关连接，不共享。
"""

from __future__ import annotations

import threading
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from code_archmage.indexer.schema import init_db

# 开发模式下允许的前端来源（Vite 默认端口 5173）
_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


def create_app(
    repo_root: Path,
    db_path: Path | None = None,
    dev_mode: bool = False,
) -> FastAPI:
    """创建 FastAPI 应用。

    Args:
        repo_root: 被索引的仓库根目录（启动时固定，生命周期内不变）
        db_path: 索引库路径，默认 repo_root / ".code_archmage_index" / "index.sqlite"
        dev_mode: 开发模式（注册 CORS 中间件，允许 Vite dev server 端口）
    """
    if db_path is None:
        db_path = repo_root / ".code_archmage_index" / "index.sqlite"

    # B-4: 首次启动建目录（全新仓库里该目录不存在，sqlite3.connect 会崩）
    db_path.parent.mkdir(parents=True, exist_ok=True)

    # 确保 schema 存在（幂等），init_db 返回的 conn 此处只需确保建表后即关闭
    conn = init_db(db_path)
    conn.close()

    app = FastAPI(title="Code Archmage")
    app.state.repo_root = Path(repo_root)
    app.state.db_path = db_path
    app.state.dev_mode = dev_mode
    # B-1: 索引并发互斥锁（同步索引防双击双跑）
    app.state.index_lock = threading.Lock()

    if dev_mode:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=_DEV_ORIGINS,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    from code_archmage.server.routes import router

    app.include_router(router)

    return app


def run_server(repo_root: Path, host: str = "127.0.0.1", port: int = 8765) -> None:
    """启动 uvicorn 服务。

    安全硬规则 1：host 强制 127.0.0.1，传 0.0.0.0 等非回环地址一律改回。
    端口默认 8765（与 .env.example 的 SERVER_PORT 一致）。
    """
    if host not in ("127.0.0.1", "localhost"):
        host = "127.0.0.1"
    app = create_app(repo_root)
    uvicorn.run(app, host=host, port=port)
