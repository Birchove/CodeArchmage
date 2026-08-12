"""pytest 公共 fixtures 与配置。"""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def fixtures_dir() -> Path:
    """返回解析测试 fixtures 目录路径。"""
    return Path(__file__).parent / "fixtures" / "python"
