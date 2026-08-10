"""Unit tests for app.logging_filters.

Pure stdlib logging tests: build synthetic LogRecords and check which
(logger, message, exception) combinations get dropped. No I/O, no real app, no
isolation env vars needed.

Why these tests were rewritten: the previous version exercised the
`websockets.server` logger and passed — but uvicorn injects ITS OWN logger
(`uvicorn.error`) into the websockets protocol
(uvicorn/protocols/websockets/websockets_impl.py, `logger=logging.getLogger(
"uvicorn.error")`), so the filter never saw the record in production. The suite
was internally consistent while validating a target that does not exist on the
real path. Hence the tests below cover BOTH logger names explicitly, with the
production one first.
"""
from __future__ import annotations

import logging

from app.logging_filters import install_benign_transfer_error_filter


def _make_os_error(winerror: int | None = None, errno_: int | None = None) -> OSError:
    """Build an OSError with winerror/errno populated the way the OS would."""
    err = OSError()
    if winerror is not None:
        # `winerror` is read-only on a normally constructed OSError; the
        # four-argument construction path is what CPython uses on Windows and the
        # only one that populates the attribute.
        err = OSError(0, "simulated", None, winerror)
    if errno_ is not None:
        err.errno = errno_
    return err


def _make_record(
    name: str,
    msg: str,
    exc: BaseException | None = None,
    level: int = logging.ERROR,
) -> logging.LogRecord:
    return logging.LogRecord(
        name=name,
        level=level,
        pathname=__file__,
        lineno=1,
        msg=msg,
        args=(),
        exc_info=(type(exc), exc, None) if exc is not None else None,
    )


def _survives(record: logging.LogRecord) -> bool:
    """Run the record's logger filters and report whether it survived.

    Mirrors what logging actually does: any filter returning False drops the
    record, and the remaining filters do not run.
    """
    logger = logging.getLogger(record.name)
    for log_filter in logger.filters:
        if not log_filter.filter(record):
            return False
    return True


def test_winerror_121_on_uvicorn_error_logger_is_dropped():
    """The real case: iPad sleeps, TCP dies without FIN, Windows returns 121.

    This is the record that actually showed up in the terminal, and its logger is
    `uvicorn.error` — not `websockets.server`.
    """
    install_benign_transfer_error_filter()

    record = _make_record("uvicorn.error", "data transfer failed", _make_os_error(winerror=121))

    assert _survives(record) is False


def test_winerror_121_on_websockets_server_logger_is_dropped():
    """Same record, on the library's default logger.

    Covered because uvicorn's override is an implementation detail of ITS own: if
    it ever stops injecting its logger, the record lands here again and the noise
    must not reappear.
    """
    install_benign_transfer_error_filter()

    record = _make_record("websockets.server", "data transfer failed", _make_os_error(winerror=121))

    assert _survives(record) is False


def test_connection_reset_is_dropped():
    """ConnectionResetError is the POSIX/WSA equivalent of the same event."""
    install_benign_transfer_error_filter()

    record = _make_record("uvicorn.error", "data transfer failed", ConnectionResetError())

    assert _survives(record) is False


def test_same_message_with_unknown_exception_survives_as_error():
    """The point the filter must NOT miss: a new error in the same branch.

    The previous version matched only (logger, message) and would therefore have
    swallowed any future failure from that branch. Here, an exception outside the
    benign-disconnect set passes through untouched, at ERROR.
    """
    install_benign_transfer_error_filter()

    record = _make_record("uvicorn.error", "data transfer failed", RuntimeError("new bug"))

    assert _survives(record) is True
    assert record.levelno == logging.ERROR


def test_same_message_without_exception_survives():
    """With no exc_info there is no way to assert this is the benign disconnect."""
    install_benign_transfer_error_filter()

    record = _make_record("uvicorn.error", "data transfer failed", None)

    assert _survives(record) is True
    assert record.levelno == logging.ERROR


def test_different_message_with_benign_exception_survives():
    """The filter is scoped to that branch's message, not to "any OSError".

    "keepalive ping timed out" is a different and informative condition (the
    client stopped answering pings) — it must not be swept up alongside.
    """
    install_benign_transfer_error_filter()

    record = _make_record("uvicorn.error", "keepalive ping timed out", _make_os_error(winerror=121))

    assert _survives(record) is True
    assert record.levelno == logging.ERROR


def test_unrelated_logger_is_untouched():
    install_benign_transfer_error_filter()

    record = _make_record("app.main", "data transfer failed", _make_os_error(winerror=121))

    assert _survives(record) is True


def test_install_is_idempotent():
    """Calling twice must not stack filters — on either target logger."""
    install_benign_transfer_error_filter()
    before = {
        name: len(logging.getLogger(name).filters)
        for name in ("uvicorn.error", "websockets.server")
    }

    install_benign_transfer_error_filter()
    install_benign_transfer_error_filter()

    for name, count in before.items():
        assert len(logging.getLogger(name).filters) == count


class _CapturingHandler(logging.Handler):
    """Handler that just accumulates the records which made it to emission."""

    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


def test_end_to_end_through_real_logging_stack():
    """Exercises the REAL path, not a synthetic LogRecord.

    This is the test with actual regression value, and the one that would have
    caught the original bug: the tests above build the record by hand and call the
    filter directly, so they would pass even with the filter attached to a logger
    nobody uses (exactly what happened with `websockets.server`).

    Here the call is identical to websockets/legacy/protocol.py:1011 —
    `logger.error("data transfer failed", exc_info=True)` from inside an `except`
    — on the logger uvicorn actually injects (`uvicorn.error`), with the level at
    WARNING the way the deploy runs it. If the filter goes back to the wrong
    logger, or back to downgrading instead of dropping, this test fails.
    """
    install_benign_transfer_error_filter()

    logger = logging.getLogger("uvicorn.error")
    handler = _CapturingHandler()
    original_level = logger.level
    logger.addHandler(handler)
    logger.setLevel(logging.WARNING)
    try:
        # 1. The real case: disappears from the log.
        try:
            raise OSError(0, "The semaphore timeout period has expired", None, 121)
        except OSError:
            logger.error("data transfer failed", exc_info=True)
        assert handler.records == []

        # 2. Unknown exception in the SAME branch: must survive, otherwise the
        #    filter would be hiding a future bug.
        try:
            raise RuntimeError("new and unknown failure")
        except RuntimeError:
            logger.error("data transfer failed", exc_info=True)
        assert len(handler.records) == 1
        assert handler.records[0].levelno == logging.ERROR

        # 3. A different message on the same logger: outside the filter's scope.
        logger.error("keepalive ping timed out")
        assert len(handler.records) == 2
    finally:
        logger.removeHandler(handler)
        logger.setLevel(original_level)
