class ExtractionError(Exception):
    def __init__(self, code: str, message: str, transient: bool = False):
        super().__init__(message)
        self.code, self.message, self.transient = code, message, transient
