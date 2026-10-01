class TraditionalRagError(Exception):
    def __init__(self, message: str, code: str = "invalid_input") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class TraditionalRagPermissionError(TraditionalRagError):
    def __init__(self, message: str = "无权执行该操作") -> None:
        super().__init__(message, "forbidden")
