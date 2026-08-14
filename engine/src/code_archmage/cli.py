"""一键启动入口（阶段 4 最小雏形，阶段 6 完善）。

用法：python -m code_archmage <repo_path> [--port 8765]

阶段 4：只起 uvicorn 服务（不开浏览器、不打包）。
阶段 6 会加 --open（开浏览器）+ pyproject.toml entry point 打包。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from code_archmage.server.app import run_server


def main(argv: list[str] | None = None) -> int:
    """CLI 入口。返回退出码（0=成功，1=参数错误）。"""
    parser = argparse.ArgumentParser(
        prog="code-archmage",
        description="Code Archmage — 只读源码拆解浏览器。启动 localhost 服务。",
    )
    parser.add_argument("repo_path", type=Path, help="要索引的仓库根目录")
    parser.add_argument("--port", type=int, default=8765, help="服务端口（默认 8765）")

    args = parser.parse_args(argv)

    repo: Path = args.repo_path
    if not repo.exists():
        print(f"错误：仓库路径不存在：{repo}", file=sys.stderr)
        return 1
    if not repo.is_dir():
        print(f"错误：路径不是目录：{repo}", file=sys.stderr)
        return 1

    print(f"Code Archmage — 启动服务（仓库：{repo}，端口：{args.port}）")
    run_server(repo, port=args.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
