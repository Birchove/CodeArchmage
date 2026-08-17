"""tests/unit/test_llm_config.py – 循环 1：LLM 配置加载（纯函数）。"""

from __future__ import annotations

from pathlib import Path

import pytest

from code_archmage.llm.config import LLMConfig, load_config


class TestLoadConfig:
    """load_config(env_path) 纯函数——从指定 .env 文件读配置，不依赖 cwd。"""

    def test_load_all_fields(self, tmp_path: Path) -> None:
        env = tmp_path / ".env"
        env.write_text(
            "LLM_API_KEY=sk-test\n"
            "LLM_BASE_URL=https://api.deepseek.com/v1\n"
            "LLM_MODEL=deepseek-chat\n"
        )
        cfg = load_config(env)
        assert cfg is not None
        assert cfg.api_key == "sk-test"
        assert cfg.base_url == "https://api.deepseek.com/v1"
        assert cfg.model == "deepseek-chat"

    def test_missing_key_returns_none(self, tmp_path: Path) -> None:
        env = tmp_path / ".env"
        env.write_text(
            "LLM_BASE_URL=https://api.deepseek.com/v1\n"
            "LLM_MODEL=deepseek-chat\n"
            # LLM_API_KEY 缺失
        )
        assert load_config(env) is None

    def test_missing_base_url_returns_none(self, tmp_path: Path) -> None:
        env = tmp_path / ".env"
        env.write_text("LLM_API_KEY=sk-test\nLLM_MODEL=deepseek-chat\n")
        assert load_config(env) is None

    def test_missing_model_returns_none(self, tmp_path: Path) -> None:
        env = tmp_path / ".env"
        env.write_text("LLM_API_KEY=sk-test\nLLM_BASE_URL=https://api.deepseek.com/v1\n")
        assert load_config(env) is None

    def test_env_file_not_found_returns_none(self, tmp_path: Path) -> None:
        assert load_config(tmp_path / "nonexistent.env") is None

    def test_does_not_crash_on_malformed_line(self, tmp_path: Path) -> None:
        env = tmp_path / ".env"
        env.write_text(
            "# a comment\n"
            "SOME_OTHER_VAR=foo\n"
            "LLM_API_KEY=sk-test\n"
            "LLM_BASE_URL=https://api.deepseek.com/v1\n"
            "LLM_MODEL=deepseek-chat\n"
            "MALFORMED LINE WITHOUT EQUALS\n"
        )
        cfg = load_config(env)
        assert cfg is not None
        assert cfg.api_key == "sk-test"

    def test_strips_quotes_from_values(self, tmp_path: Path) -> None:
        env = tmp_path / ".env"
        env.write_text(
            'LLM_API_KEY="sk-quoted"\n'
            "LLM_BASE_URL='https://api.example.com/v1'\n"
            "LLM_MODEL=my-model\n"
        )
        cfg = load_config(env)
        assert cfg is not None
        assert cfg.api_key == "sk-quoted"
        assert cfg.base_url == "https://api.example.com/v1"

    def test_config_is_frozen(self, tmp_path: Path) -> None:
        env = tmp_path / ".env"
        env.write_text(
            "LLM_API_KEY=sk-test\n"
            "LLM_BASE_URL=https://api.deepseek.com/v1\n"
            "LLM_MODEL=deepseek-chat\n"
        )
        cfg = load_config(env)
        assert cfg is not None
        with pytest.raises((AttributeError, TypeError)):
            cfg.api_key = "changed"  # type: ignore[misc]

    def test_none_env_path_with_no_cwd_env_returns_none(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """传 None 时不依赖 cwd，若无默认 .env 则返回 None。"""
        monkeypatch.chdir(tmp_path)  # 空目录，无 .env
        result = load_config(None)
        assert result is None
