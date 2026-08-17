"""LLM 配置加载。

load_config(env_path) 仍是纯函数：读单个 .env，缺字段返回 None。
discover_llm_config() 会在「被阅读仓库 / 当前目录 / 本工具仓库根」里查找，
并区分：找不到文件、字段不全、仍是示例占位值。
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

_REQUIRED_FIELDS: tuple[str, ...] = ("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL")

_PLACEHOLDER_KEYS = frozenset(
    {
        "your-api-key-here",
        "sk-xxx",
        "sk-your-api-key-here",
        "changeme",
        "replace-me",
    }
)


class ConfigStatus(enum.StrEnum):
    """配置加载结果（给前端/CLI 的分类，不含密钥）。"""

    OK = "ok"
    NOT_FOUND = "not_found"
    INCOMPLETE = "incomplete"
    PLACEHOLDER = "placeholder"


@dataclass(frozen=True)
class LLMConfig:
    """LLM 网关配置（不可变）。"""

    api_key: str
    base_url: str
    model: str


@dataclass(frozen=True)
class ConfigLoadResult:
    """一次配置查找的结果。message 面向用户，绝不包含 api_key。"""

    status: ConfigStatus
    config: LLMConfig | None
    env_path: Path | None
    missing_fields: tuple[str, ...]
    message: str


def load_config(env_path: Path | None = None) -> LLMConfig | None:
    """从指定 .env 文件加载 LLM 配置。

    Args:
        env_path: .env 文件路径。传 None 时尝试 cwd/.env。
                  文件不存在 → 返回 None（不抛异常）。

    Returns:
        LLMConfig 实例；任何必填字段缺失或仍是占位值 → 返回 None。
    """
    if env_path is None:
        env_path = Path.cwd() / ".env"
    return parse_env_file(env_path).config


def parse_env_file(env_path: Path) -> ConfigLoadResult:
    """解析单个 .env，区分找不到 / 缺字段 / 占位值 / 成功。"""
    if not env_path.is_file():
        return ConfigLoadResult(
            status=ConfigStatus.NOT_FOUND,
            config=None,
            env_path=env_path,
            missing_fields=_REQUIRED_FIELDS,
            message=f"未找到配置文件 {env_path}。请复制 .env.example 为 .env 并填写。",
        )

    values = _parse_env_text(env_path.read_text(encoding="utf-8-sig"))
    missing = tuple(name for name in _REQUIRED_FIELDS if not values.get(name, "").strip())
    if missing:
        shown = "、".join(missing)
        return ConfigLoadResult(
            status=ConfigStatus.INCOMPLETE,
            config=None,
            env_path=env_path,
            missing_fields=missing,
            message=(
                f"已找到 {env_path}，但缺少 {shown}。"
                "这三项都要填，和「完全没配 .env」不是同一回事。"
            ),
        )

    api_key = values["LLM_API_KEY"]
    base_url = _normalize_base_url(values["LLM_BASE_URL"])
    model = values["LLM_MODEL"]
    if _is_placeholder_key(api_key):
        return ConfigLoadResult(
            status=ConfigStatus.PLACEHOLDER,
            config=None,
            env_path=env_path,
            missing_fields=(),
            message=(
                f"已找到 {env_path}，但 LLM_API_KEY 仍是 .env.example 里的占位值。"
                "请换成你自己的密钥后重启引擎。"
            ),
        )

    return ConfigLoadResult(
        status=ConfigStatus.OK,
        config=LLMConfig(api_key=api_key, base_url=base_url, model=model),
        env_path=env_path,
        missing_fields=(),
        message=f"LLM 已配置（模型：{model}，配置文件：{env_path}）",
    )


def discover_llm_config(
    repo: Path,
    env_path: Path | None = None,
) -> ConfigLoadResult:
    """按优先级查找 .env：--env 指定路径 > 被阅读仓库 > cwd > 本工具根目录。

    本工具根目录 = 同时含 engine/ 和 web/ 的目录。这样
    `uv run --directory engine python -m code_archmage .` 也能读到仓库根的 .env。
    """
    if env_path is not None:
        return parse_env_file(env_path)

    existing = [p for p in _candidate_env_paths(repo) if p.is_file()]
    if not existing:
        return ConfigLoadResult(
            status=ConfigStatus.NOT_FOUND,
            config=None,
            env_path=None,
            missing_fields=_REQUIRED_FIELDS,
            message=(
                "未找到 .env。请把 .env.example 复制到本工具仓库根目录"
                "（与 engine/、web/ 同级），填写 LLM_API_KEY、LLM_BASE_URL、LLM_MODEL 后重启引擎。"
            ),
        )

    last_bad: ConfigLoadResult | None = None
    for path in existing:
        result = parse_env_file(path)
        if result.status is ConfigStatus.OK:
            return result
        last_bad = result
    assert last_bad is not None
    return last_bad


def default_unconfigured_result() -> ConfigLoadResult:
    """测试里只传 llm_config=None 时的默认状态。"""
    return ConfigLoadResult(
        status=ConfigStatus.NOT_FOUND,
        config=None,
        env_path=None,
        missing_fields=_REQUIRED_FIELDS,
        message=(
            "未找到 .env。请把 .env.example 复制到本工具仓库根目录"
            "（与 engine/、web/ 同级），填写 LLM_API_KEY、LLM_BASE_URL、LLM_MODEL 后重启引擎。"
        ),
    )


def result_from_injected_config(llm_config: LLMConfig | None) -> ConfigLoadResult:
    """测试或 create_app 直接注入 LLMConfig 时，补全对外状态。"""
    if llm_config is None:
        return default_unconfigured_result()
    return ConfigLoadResult(
        status=ConfigStatus.OK,
        config=llm_config,
        env_path=None,
        missing_fields=(),
        message=f"LLM 已配置（模型：{llm_config.model}）",
    )


def _is_tool_root(path: Path) -> bool:
    return (path / "engine").is_dir() and (path / "web").is_dir()


def _candidate_env_paths(repo: Path) -> list[Path]:
    """去重后的候选 .env 路径（先写的优先）。"""
    ordered: list[Path] = []
    seen: set[Path] = set()

    def add(path: Path) -> None:
        try:
            resolved = path.resolve()
        except OSError:
            return
        if resolved in seen:
            return
        seen.add(resolved)
        ordered.append(resolved)

    add(Path(repo) / ".env")
    add(Path.cwd() / ".env")
    try:
        cwd = Path.cwd().resolve()
    except OSError:
        cwd = Path.cwd()
    for parent in (cwd, *cwd.parents):
        if _is_tool_root(parent):
            add(parent / ".env")
            break
    here = Path(__file__).resolve()
    for parent in here.parents:
        if _is_tool_root(parent):
            add(parent / ".env")
            break
    return ordered


def _normalize_base_url(url: str) -> str:
    """OpenAI 兼容接口的 chat 路径在 /v1 下。

    OpenAI SDK 会自己补 /v1，所以 DeepSeek 文档常写 https://api.deepseek.com。
    本引擎直调 /chat/completions，根路径必须补上，否则对话会 404，却仍显示「已配置」。
    """
    url = url.strip().rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme and parsed.netloc and parsed.path in ("", "/"):
        return f"{url}/v1"
    return url


def _is_placeholder_key(api_key: str) -> bool:
    lowered = api_key.strip().lower()
    if lowered in _PLACEHOLDER_KEYS:
        return True
    return "your-api-key" in lowered


def _parse_env_text(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
            val = val[1:-1]
        values[key] = val
    return values
