"""工具函数。"""


def format_result(result):
    """格式化结果为字符串。"""
    cfg = load()
    return f"Result: {result} ({cfg})"


def load():
    """加载配置（与 operations.load 同名，用于多候选跳转的 E2E 场景）。"""
    return {"format": "plain"}
