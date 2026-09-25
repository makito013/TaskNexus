"""Tests app/codex_notify_adapter.py as a REAL standalone Python subprocess
(never mocked) with a live localhost HTTP listener on a background thread —
this is the path the OpenAI `codex` CLI actually drives when it fires its
end-of-turn `notify` program.

The adapter's contract is narrow and absolute:
  argv = [<python>, <adapter>, <session_id>, <hook_stop_url>, <codex json?>]
  -> POST {"session_id": <session_id>} to <hook_stop_url>
  -> ALWAYS exit 0, never block, never raise — any failure is logged to stderr.
"""

import json
import os
import queue as queue_mod
import ssl
import subprocess
import sys
import threading
import http.server

import pytest

ADAPTER_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "app", "codex_notify_adapter.py"
)


class _CapturingHandler(http.server.BaseHTTPRequestHandler):
    received: "queue_mod.Queue" = queue_mod.Queue()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        self.__class__.received.put({
            "path": self.path,
            "headers": dict(self.headers),
            "body": json.loads(body) if body else None,
        })
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, fmt, *args):
        pass


def _start_server(ssl_context=None):
    _CapturingHandler.received = queue_mod.Queue()
    server = http.server.HTTPServer(("127.0.0.1", 0), _CapturingHandler)
    if ssl_context is not None:
        server.socket = ssl_context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, server.server_address[1]


def _run_adapter(session_id, url, payload_argv=None, timeout=10):
    argv = [sys.executable, ADAPTER_PATH, session_id, url]
    if payload_argv is not None:
        argv.append(payload_argv)
    return subprocess.run(
        argv,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def test_notify_adapter_posts_session_id_to_live_listener():
    server, port = _start_server()
    try:
        url = "http://127.0.0.1:{0}/api/hooks/stop".format(port)
        result = _run_adapter("sess-live-1", url)
        assert result.returncode == 0

        received = _CapturingHandler.received.get(timeout=3.0)
        assert received["path"] == "/api/hooks/stop"
        assert received["body"] == {"session_id": "sess-live-1"}
        assert received["headers"].get("Content-Type") == "application/json"
    finally:
        server.shutdown()


def test_notify_adapter_exits_zero_against_dead_port():
    # Port 1: privileged and unlistened -> connection refused.
    result = _run_adapter("sess-dead", "http://127.0.0.1:1/api/hooks/stop")
    assert result.returncode == 0


def test_notify_adapter_exits_zero_with_no_payload_argv():
    server, port = _start_server()
    try:
        url = "http://127.0.0.1:{0}/api/hooks/stop".format(port)
        result = _run_adapter("sess-no-payload", url, payload_argv=None)
        assert result.returncode == 0
        received = _CapturingHandler.received.get(timeout=3.0)
        assert received["body"] == {"session_id": "sess-no-payload"}
    finally:
        server.shutdown()


def test_notify_adapter_reads_json_payload_from_last_argv():
    server, port = _start_server()
    try:
        url = "http://127.0.0.1:{0}/api/hooks/stop".format(port)
        payload = json.dumps({
            "type": "agent-turn-complete",
            "thread-id": "th-42",
            "turn-id": "tn-7",
            "cwd": r"C:\projetos\meu",
            "last-assistant-message": "done",
        })
        result = _run_adapter("sess-payload", url, payload_argv=payload)
        assert result.returncode == 0

        # Payload is log-only; the POST body must still be just our session_id.
        received = _CapturingHandler.received.get(timeout=3.0)
        assert received["body"] == {"session_id": "sess-payload"}
        # The adapter logs the parsed event to stderr.
        assert "agent-turn-complete" in result.stderr
        assert "th-42" in result.stderr
    finally:
        server.shutdown()


def test_notify_adapter_exits_zero_with_only_script_path_in_argv():
    """QA gap: `_run_adapter` always supplies session_id AND url, so the
    `len(argv) < 3` early-return branch had no fixture. codex could
    theoretically misfire the notify with a truncated argv — the adapter must
    still exit 0, never traceback."""
    result = subprocess.run(
        [sys.executable, ADAPTER_PATH],
        stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == 0
    assert "Traceback" not in result.stderr


def test_notify_adapter_empty_session_id_still_posts():
    """QA gap: an empty session_id is not a crash — it posts
    {"session_id": ""} and exits 0 (correlation just fails downstream, which
    is the backend's problem, not the adapter's)."""
    server, port = _start_server()
    try:
        url = "http://127.0.0.1:{0}/api/hooks/stop".format(port)
        result = _run_adapter("", url)
        assert result.returncode == 0
        received = _CapturingHandler.received.get(timeout=3.0)
        assert received["body"] == {"session_id": ""}
    finally:
        server.shutdown()


def test_notify_adapter_malformed_url_exits_zero():
    """QA gap: a malformed hook URL (no scheme) makes urllib raise — must be
    swallowed, exit 0, no traceback."""
    result = _run_adapter("sess-bad-url", "not-a-valid-url")
    assert result.returncode == 0
    assert "Traceback" not in result.stderr


def test_notify_adapter_non_json_payload_argv_exits_zero_and_still_posts():
    """QA gap: `argv[-1]` that is not JSON must not break the POST — payload
    parsing is best-effort/log-only and its failure is isolated from the
    notification."""
    server, port = _start_server()
    try:
        url = "http://127.0.0.1:{0}/api/hooks/stop".format(port)
        result = _run_adapter("sess-garbage", url, payload_argv="}{ not json")
        assert result.returncode == 0
        received = _CapturingHandler.received.get(timeout=3.0)
        assert received["body"] == {"session_id": "sess-garbage"}
    finally:
        server.shutdown()


def test_notify_adapter_posts_before_reading_stdin_that_never_closes():
    """QA gap (invariant with zero coverage): the adapter does the POST BEFORE
    touching the payload, specifically so a stdin pipe the parent opens and
    never closes cannot hang the end-of-turn notification forever. Every
    other test uses stdin=DEVNULL, so reordering POST after the read was a
    mutation nothing caught. Here the parent keeps the write end of the pipe
    open for the whole run: the POST must still land and the process must
    still exit 0 well within the timeout."""
    server, port = _start_server()
    proc = None
    try:
        url = "http://127.0.0.1:{0}/api/hooks/stop".format(port)
        # No payload argv -> the adapter's fallback path would read stdin.
        proc = subprocess.Popen(
            [sys.executable, ADAPTER_PATH, "sess-hang", url],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        received = _CapturingHandler.received.get(timeout=5.0)
        assert received["body"] == {"session_id": "sess-hang"}
        proc.stdin.close()
        assert proc.wait(timeout=5) == 0
    finally:
        if proc is not None:
            if proc.poll() is None:
                proc.kill()
            proc.wait(timeout=5)
            for stream in (proc.stdin, proc.stdout, proc.stderr):
                if stream is not None:
                    try:
                        stream.close()
                    except Exception:
                        pass
        server.shutdown()


def test_notify_adapter_https_url_does_not_fail_cert_validation(tmp_path):
    cryptography = pytest.importorskip(
        "cryptography", reason="cryptography unavailable to mint a self-signed cert"
    )
    from datetime import datetime, timedelta, timezone

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "box.local")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.now(timezone.utc) - timedelta(days=1))
        .not_valid_after(datetime.now(timezone.utc) + timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    cert_file = tmp_path / "cert.pem"
    key_file = tmp_path / "key.pem"
    cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_file.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=str(cert_file), keyfile=str(key_file))

    server, port = _start_server(ssl_context=ctx)
    try:
        url = "https://127.0.0.1:{0}/api/hooks/stop".format(port)
        result = _run_adapter("sess-https", url)
        assert result.returncode == 0
        received = _CapturingHandler.received.get(timeout=3.0)
        assert received["body"] == {"session_id": "sess-https"}
    finally:
        server.shutdown()
