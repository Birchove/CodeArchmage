"""入口模块。"""

from calculator import Calculator


def main():
    """程序入口。"""
    calc = Calculator()
    result = calc.add(1, 2)
    print(result)


if __name__ == "__main__":
    main()
