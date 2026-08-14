"""计算器模块。"""

from operations import add_numbers


class Calculator:
    """简单计算器。"""

    def add(self, a, b):
        """加法。"""
        return add_numbers(a, b)

    def subtract(self, a, b):
        """减法。"""
        return add_numbers(a, -b)
