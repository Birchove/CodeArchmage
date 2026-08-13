"""路径沙箱：防止路径穿越攻击。

安全硬规则 2-3 的实现：
- 规则 2：路径沙箱（读）—— resolve 后检查 target 在 repo_root 内
- 规则 3：拒绝符号链接（读）—— 一律拒绝 symlink，与索引侧规则 4 一致，
  避免仓库内 symlink 读取时内容/符号大纲错位（cc B-2）

root 和 target 都 resolve（处理 macOS /tmp → /private/tmp symlink 语义）。
"""

from __future__ import annotations

from pathlib import Path


class PathEscapeError(Exception):
    """路径逃逸仓库根目录，或路径是符号链接。"""


def resolve_path(repo_root: Path, rel_path: str) -> Path:
    """将相对路径解析为仓库根内的绝对路径，拒绝逃逸和符号链接。

    Args:
        repo_root: 仓库根目录（会 resolve，处理 macOS symlink 语义）
        rel_path: 相对路径，如 "src/main.py" 或 "../../etc/passwd"

    Returns:
        resolve 后的绝对路径，保证在 repo_root 内且非符号链接

    Raises:
        PathEscapeError: 路径逃逸仓库根（含 .. 穿越、绝对路径注入）、
            或路径是符号链接（一律拒绝，与索引侧规则 4 一致）
    """
    root = Path(repo_root).resolve()
    raw_target = root / rel_path
    # 一律拒绝符号链接（cc B-2：与索引侧规则 4 一致，避免内容/符号错位）
    if raw_target.is_symlink():
        raise PathEscapeError(f"拒绝符号链接：{rel_path!r}")
    target = raw_target.resolve()
    try:
        target.relative_to(root)
    except ValueError:
        raise PathEscapeError(f"路径逃逸仓库根：{rel_path!r}") from None
    return target
