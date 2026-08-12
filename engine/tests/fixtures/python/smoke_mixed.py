"""综合冒烟 fixture：混合所有语法特性，作为回归基线。

任何解析器改动后，这个文件的解析结果都应保持稳定。
如果结果变了，必须确认是预期改动还是回归。
"""

import os
from typing import Dict


@dataclass
class Config(BaseConfig):
    """配置类。"""

    name: str
    timeout: int = 30

    def get_name(self) -> str:
        return self.name


def create_config(path: str) -> Config:
    """工厂函数。"""
    data = load(path)
    return Config(name=data["name"])


def load(path: str) -> Dict:
    return {}
