"""路径沙箱安全测试。

覆盖阶段 3 循环 1-2：
- 循环 1：路径沙箱基础（.. 穿越、绝对路径注入）
- 循环 2：符号链接逃逸（读）
"""

from __future__ import annotations

from pathlib import Path

import pytest

from code_archmage.server.security import PathEscapeError, resolve_path


class TestResolvePathBasic:
    """循环 1：路径沙箱基础。"""

    def test_normal_relative_path_returns_resolved_absolute(self, tmp_path: Path) -> None:
        """正常相对路径返回仓库根内的 resolve 后绝对路径。"""
        (tmp_path / "src").mkdir()
        (tmp_path / "src" / "main.py").touch()
        result = resolve_path(tmp_path, "src/main.py")
        assert result == tmp_path.resolve() / "src" / "main.py"

    def test_root_itself_is_valid(self, tmp_path: Path) -> None:
        """仓库根本身是合法路径。"""
        result = resolve_path(tmp_path, ".")
        assert result == tmp_path.resolve()

    def test_dotdot_traversal_rejected(self, tmp_path: Path) -> None:
        """../../etc/passwd 逃逸被拒绝。"""
        with pytest.raises(PathEscapeError):
            resolve_path(tmp_path, "../../etc/passwd")

    def test_absolute_path_injection_rejected(self, tmp_path: Path) -> None:
        """直接传绝对路径 /etc/passwd 被拒绝。"""
        with pytest.raises(PathEscapeError):
            resolve_path(tmp_path, "/etc/passwd")

    def test_nested_dotdot_traversal_rejected(self, tmp_path: Path) -> None:
        """深层 .. 穿越被拒绝。"""
        with pytest.raises(PathEscapeError):
            resolve_path(tmp_path, "a/b/../../../etc/passwd")

    def test_sneaky_traversal_rejected(self, tmp_path: Path) -> None:
        """中间正常、末尾穿越被拒绝。"""
        (tmp_path / "src").mkdir()
        with pytest.raises(PathEscapeError):
            resolve_path(tmp_path, "src/../../etc/passwd")


class TestSymlinkEscape:
    """循环 2：符号链接逃逸（读）。"""

    def test_symlink_to_outside_rejected(
        self, tmp_path: Path, tmp_path_factory: pytest.TempPathFactory
    ) -> None:
        """仓库内 symlink 指向仓库外 → PathEscapeError。"""
        outside = tmp_path_factory.mktemp("outside")
        (outside / "secret.py").touch()
        link = tmp_path / "leak.py"
        link.symlink_to(outside / "secret.py")
        with pytest.raises(PathEscapeError):
            resolve_path(tmp_path, "leak.py")

    def test_symlink_to_inside_also_rejected(
        self, tmp_path: Path, tmp_path_factory: pytest.TempPathFactory
    ) -> None:
        """仓库内 symlink 指向仓库内文件 → 也拒绝（cc B-2：与索引侧规则 4 一致，避免错位）。"""
        del tmp_path_factory  # 不需要外部目录
        (tmp_path / "real.py").touch()
        link = tmp_path / "alias.py"
        link.symlink_to(tmp_path / "real.py")
        with pytest.raises(PathEscapeError):
            resolve_path(tmp_path, "alias.py")

    def test_symlink_dir_to_outside_rejected(
        self, tmp_path: Path, tmp_path_factory: pytest.TempPathFactory
    ) -> None:
        """仓库内 symlink 目录指向仓库外，访问其下文件 → 拒绝。"""
        outside = tmp_path_factory.mktemp("outside_dir")
        (outside / "secret.py").touch()
        link_dir = tmp_path / "leakdir"
        link_dir.symlink_to(outside)
        with pytest.raises(PathEscapeError):
            resolve_path(tmp_path, "leakdir/secret.py")
