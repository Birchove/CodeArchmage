"""Code Archmage 服务层（FastAPI）。

公共 API：
- create_app: 应用工厂
- run_server: 启动服务（只绑 127.0.0.1）
- resolve_path: 路径沙箱
- PathEscapeError: 路径逃逸异常
"""

from code_archmage.server.app import create_app, run_server
from code_archmage.server.security import PathEscapeError, resolve_path

__all__ = ["PathEscapeError", "create_app", "resolve_path", "run_server"]
