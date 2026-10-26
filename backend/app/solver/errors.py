# =============================================================
# 求解器自定义异常
# 所有可预期的电路错误都以 CircuitError 抛出，并由 API 层转为统一错误响应。
# =============================================================


class CircuitError(Exception):
    """电路求解错误：携带机器可读的 code 与中文提示 message。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message