"""Smoke test — 验证 pytest 与项目导入链路畅通。

阶段 0 的唯一测试目标：确认测试框架能跑、包能导入。
真正的功能测试从阶段 1 开始。
"""

from __future__ import annotations

import code_archmage


def test_package_importable() -> None:
    """包能被正常导入。"""
    assert hasattr(code_archmage, "__version__")


def test_version_is_string() -> None:
    """版本号是字符串。"""
    assert isinstance(code_archmage.__version__, str)
    assert len(code_archmage.__version__) > 0


def test_arithmetic() -> None:
    """最基础的断言能通过（验证 pytest 本身工作）。"""
    assert 1 + 1 == 2
