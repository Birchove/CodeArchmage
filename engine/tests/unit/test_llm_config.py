"""tests/unit/test_llm_config.py – 循环 1：LLM 配置加载（纯函数）。"""

from __future__ import annotations

from pathlib import Path

import pytest

from code_archmage.llm.config import (
    ConfigStatus,
    discover_llm_config,
    load_config,
    parse_env_file,
)


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
            "LLM_BASE_URL=https://api.deepseek.com/v1\nLLM_MODEL=deepseek-chat\n"
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

    def test_none_env_path_with_no_cwd_env_returns_none(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """传 None 时不依赖 cwd，若无默认 .env 则返回 None。"""
        monkeypatch.chdir(tmp_path)  # 空目录，无 .env
        result = load_config(None)
        assert result is None


class TestParseEnvFile:
    """parse_env_file 区分找不到 / 缺字段 / 占位值，message 不含密钥。"""

    def test_incomplete_is_not_not_found(self, tmp_path: Path) -> None:
        env = tmp_path / ".env"
        env.write_text("LLM_BASE_URL=https://api.deepseek.com/v1\nLLM_MODEL=deepseek-chat\n")
        result = parse_env_file(env)
        assert result.status is ConfigStatus.INCOMPLETE
        assert result.config is None
        assert result.missing_fields == ("LLM_API_KEY",)
        assert "缺少" in result.message
        assert "LLM_API_KEY" in result.message
        assert "未找到" not in result.message

    def test_placeholder_is_not_not_found(self, tmp_path: Path) -> None:
        env = tmp_path / ".env"
        env.write_text(
            "LLM_API_KEY=your-api-key-here\n"
            "LLM_BASE_URL=https://api.deepseek.com/v1\n"
            "LLM_MODEL=deepseek-chat\n"
        )
        result = parse_env_file(env)
        assert result.status is ConfigStatus.PLACEHOLDER
        assert result.config is None
        assert "占位" in result.message
        assert load_config(env) is None

    def test_not_found_names_the_path(self, tmp_path: Path) -> None:
        env = tmp_path / "missing.env"
        result = parse_env_file(env)
        assert result.status is ConfigStatus.NOT_FOUND
        assert str(env) in result.message

    def test_ok_message_does_not_include_api_key(self, tmp_path: Path) -> None:
        env = tmp_path / ".env"
        env.write_text(
            "LLM_API_KEY=sk-secret-must-not-leak\n"
            "LLM_BASE_URL=https://api.deepseek.com/v1\n"
            "LLM_MODEL=deepseek-chat\n"
        )
        result = parse_env_file(env)
        assert result.status is ConfigStatus.OK
        assert result.config is not None
        assert "sk-secret-must-not-leak" not in result.message

    def test_root_host_url_gets_v1_suffix(self, tmp_path: Path) -> None:
        env = tmp_path / ".env"
        env.write_text(
            "LLM_API_KEY=sk-test\n"
            "LLM_BASE_URL=https://api.deepseek.com\n"
            "LLM_MODEL=deepseek-v4-pro\n"
        )
        cfg = load_config(env)
        assert cfg is not None
        assert cfg.base_url == "https://api.deepseek.com/v1"

    def test_existing_v1_url_unchanged(self, tmp_path: Path) -> None:
        env = tmp_path / ".env"
        env.write_text(
            "LLM_API_KEY=sk-test\n"
            "LLM_BASE_URL=https://api.deepseek.com/v1\n"
            "LLM_MODEL=deepseek-chat\n"
        )
        cfg = load_config(env)
        assert cfg is not None
        assert cfg.base_url == "https://api.deepseek.com/v1"


class TestDiscoverLlmConfig:
    """discover_llm_config：uv run --directory engine 时仍能读到工具根目录 .env。"""

    def _write_ok_env(self, path: Path, model: str = "root-model") -> None:
        path.write_text(
            f"LLM_API_KEY=sk-root\nLLM_BASE_URL=https://api.example.com/v1\nLLM_MODEL={model}\n"
        )

    def test_finds_env_in_tool_root_when_cwd_is_engine(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        tool = tmp_path / "code_archmage"
        (tool / "engine").mkdir(parents=True)
        (tool / "web").mkdir()
        self._write_ok_env(tool / ".env", "from-tool-root")
        repo = tool / "engine"
        monkeypatch.chdir(repo)
        result = discover_llm_config(repo)
        assert result.status is ConfigStatus.OK
        assert result.config is not None
        assert result.config.model == "from-tool-root"
        assert "sk-root" not in result.message

    def test_explicit_env_path_wins(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        tool = tmp_path / "code_archmage"
        (tool / "engine").mkdir(parents=True)
        (tool / "web").mkdir()
        self._write_ok_env(tool / ".env", "ignored")
        custom = tmp_path / "custom.env"
        self._write_ok_env(custom, "from-flag")
        monkeypatch.chdir(tool / "engine")
        result = discover_llm_config(tool / "engine", custom)
        assert result.config is not None
        assert result.config.model == "from-flag"

    def test_incomplete_repo_env_is_reported_when_it_is_the_only_file(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        env = tmp_path / ".env"
        env.write_text("LLM_MODEL=only-model\n")
        monkeypatch.setattr(
            "code_archmage.llm.config._candidate_env_paths",
            lambda repo: [env],
        )
        result = discover_llm_config(tmp_path)
        assert result.status is ConfigStatus.INCOMPLETE
        assert "缺少" in result.message
        assert "LLM_API_KEY" in result.message
        assert "未找到" not in result.message
