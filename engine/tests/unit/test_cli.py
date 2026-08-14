"""CLI 雏形测试（循环 12，S-3/S-4）。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from code_archmage.cli import main


class TestCLI:
    """阶段 4 最小 CLI 雏形。"""

    def test_no_args_exits_with_error(self) -> None:
        """无参数 → argparse 报错退出（SystemExit code=2）。"""
        with pytest.raises(SystemExit) as exc_info:
            main([])
        assert exc_info.value.code == 2

    def test_nonexistent_path_returns_1(self, capsys: pytest.CaptureFixture[str]) -> None:
        """不存在的路径 → 返回 1 + 错误信息。"""
        code = main(["/nonexistent/path/that/does/not/exist/xyz"])
        assert code == 1
        captured = capsys.readouterr()
        assert "不存在" in captured.err

    def test_file_not_dir_returns_1(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """路径指向文件而非目录 → 返回 1。"""
        file_path = tmp_path / "not_a_dir.txt"
        file_path.write_text("x")
        code = main([str(file_path)])
        assert code == 1
        captured = capsys.readouterr()
        assert "目录" in captured.err

    def test_valid_path_calls_run_server(self, tmp_path: Path) -> None:
        """有效目录 → 调用 run_server，返回 0。"""
        with patch("code_archmage.cli.run_server") as mock_run:
            code = main([str(tmp_path)])
            assert code == 0
            mock_run.assert_called_once()

    def test_default_port_is_8765(self, tmp_path: Path) -> None:
        """默认端口 8765。"""
        with patch("code_archmage.cli.run_server") as mock_run:
            main([str(tmp_path)])
            _, kwargs = mock_run.call_args
            assert kwargs.get("port", 8765) == 8765

    def test_custom_port(self, tmp_path: Path) -> None:
        """--port 参数正确传递（S-4：测试用非默认端口）。"""
        with patch("code_archmage.cli.run_server") as mock_run:
            main([str(tmp_path), "--port", "8766"])
            _, kwargs = mock_run.call_args
            assert kwargs["port"] == 8766

    def test_repo_path_passed_correctly(self, tmp_path: Path) -> None:
        """repo_path 作为 Path 对象传递给 run_server。"""
        with patch("code_archmage.cli.run_server") as mock_run:
            main([str(tmp_path)])
            args, _ = mock_run.call_args
            assert args[0] == tmp_path
