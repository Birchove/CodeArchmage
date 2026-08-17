"""LLM 配置加载。

load_config(env_path) 是纯函数：从指定 .env 文件路径读取 LLM 配置，
不依赖进程 cwd，不调用 os.environ。缺少任何必填字段时返回 None（不崩溃）。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class LLMConfig:
    """LLM 网关配置（不可变）。"""

    api_key: str
    base_url: str
    model: str


def load_config(env_path: Path | None = None) -> LLMConfig | None:
    """从指定 .env 文件加载 LLM 配置。

    Args:
        env_path: .env 文件路径。传 None 时尝试 cwd/.env。
                  文件不存在 → 返回 None（不抛异常）。

    Returns:
        LLMConfig 实例；任何必填字段缺失 → 返回 None。
    """
    if env_path is None:
        env_path = Path.cwd() / ".env"

    if not env_path.is_file():
        return None

    values: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        # 去除首尾引号（单引号或双引号）
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
            val = val[1:-1]
        values[key] = val

    api_key = values.get("LLM_API_KEY", "")
    base_url = values.get("LLM_BASE_URL", "")
    model = values.get("LLM_MODEL", "")

    if not api_key or not base_url or not model:
        return None

    return LLMConfig(api_key=api_key, base_url=base_url, model=model)
