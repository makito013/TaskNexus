"""CA20a / ADR-41: the SDK is loaded lazily, and the backend serves the V2 without it.

Runs in subprocesses of the same interpreter with the full set of variables the app's
lifespan needs (CT10): without them the lifespan could write to `~/.claude.json`, scan
`D:\\projetos` or bind port 8765.
"""
from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
APP_DIR = BACKEND / "app"
WORKTREE = BACKEND.parent


def _env(tmp_path: Path) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE") and k != "HOOK_LOOPBACK_PORT"}
    (tmp_path / "meu-projeto" / ".claude").mkdir(parents=True, exist_ok=True)
    env.update({
        "PROJECTS_ROOT": str(tmp_path), "SESSIONS_DB": str(tmp_path / "sessions.db"),
        "CLAUDE_CONFIG_PATH": str(tmp_path / "claude.json"), "BOARD_UPLOADS_ROOT": str(tmp_path / "uploads"),
        "BOARD_ATTACHMENTS_ROOT": str(tmp_path / "attachments"), "CLEANUP_DELAY": "0.1",
        "PYTHONPATH": str(BACKEND), "PYTHONUTF8": "1",
    })
    return env


def _run(code: str, tmp_path: Path) -> subprocess.CompletedProcess:
    status_before = subprocess.run(["git", "status", "--porcelain"], cwd=WORKTREE, capture_output=True, text=True).stdout
    result = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env=_env(tmp_path),
                            capture_output=True, text=True, timeout=120)
    # CT10: the child never leaves a folder behind in the worktree.
    status_after = subprocess.run(["git", "status", "--porcelain"], cwd=WORKTREE, capture_output=True, text=True).stdout
    assert status_after == status_before
    return result


def test_importing_the_app_does_not_load_the_sdk(tmp_path):
    result = _run(
        "import sys\nimport app.main\n"
        "print(json.dumps({'sdk': 'claude_agent_sdk' in sys.modules, 'chat': 'app.chat.sdk_engine' in sys.modules}))"
        .replace("json.dumps", "__import__('json').dumps"),
        tmp_path,
    )

    assert result.returncode == 0, result.stderr
    loaded = json.loads(result.stdout.strip().splitlines()[-1])
    # the engine module is imported (it only knows how to import the SDK later); the SDK is not
    assert loaded == {"sdk": False, "chat": True}


def test_with_the_sdk_import_blocked_the_v2_serves_and_the_chat_says_engine_unavailable(tmp_path):
    code = """
import json, sys
sys.modules['claude_agent_sdk'] = None          # `import claude_agent_sdk` now raises ImportError
from fastapi.testclient import TestClient
import app.main as m
out = {}
with TestClient(m.app) as c:
    out['status'] = c.get('/api/status').status_code
    out['persisted'] = c.get('/api/sessions/persisted').status_code
    out['projects'] = c.get('/api/projects').status_code
    out['agents'] = c.get('/api/agents').status_code
    health = c.get('/api/chat/health').json()
    out['sdk_available'] = health['sdk']['available']
    created = c.post('/api/chat/sessions', json={'project_ref': 'meu-projeto', 'agent_id': 'claude'})
    out['create'] = [created.status_code, created.json()['detail']['code']]
    out['chat_sessions'] = c.get('/api/chat/sessions').status_code
    with c.websocket_connect('/ws/chat/nope::claude::zzzzzz') as ws:
        try:
            ws.receive_json()
        except Exception as exc:
            out['ws_code'] = getattr(exc, 'code', None)
print(json.dumps(out))
"""
    result = _run(code, tmp_path)

    assert result.returncode == 0, result.stderr
    out = json.loads(result.stdout.strip().splitlines()[-1])
    assert (out["status"], out["persisted"], out["projects"], out["agents"]) == (200, 200, 200, 200)
    assert out["sdk_available"] is False and out["chat_sessions"] == 200
    assert out["create"] in ([503, "engine_unavailable"], [404, "agent_not_found"]) and out["create"][0] != 500
    assert out["ws_code"] == 4404


def test_the_engine_unavailable_answer_for_a_known_agent_is_503(tmp_path):
    code = """
import json, sys
sys.modules['claude_agent_sdk'] = None
from fastapi.testclient import TestClient
import app.main as m
with TestClient(m.app) as c:
    c.post('/api/agents', json={'id': 'claude', 'nome': 'A', 'papel': 'p', 'ia': 'claude', 'cmd': ['claude']})
    r = c.post('/api/chat/sessions', json={'project_ref': 'meu-projeto', 'agent_id': 'claude'})
    print(json.dumps([r.status_code, r.json()['detail']['code']]))
"""
    result = _run(code, tmp_path)

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout.strip().splitlines()[-1]) == [503, "engine_unavailable"]


def _imports(path: Path) -> list[tuple[int, bool]]:
    """(line, at_module_level) of every real import of the SDK package in a file."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found = []
    for parent in ast.walk(tree):
        for node in ast.iter_child_nodes(parent):
            names = []
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
            if any(name == "claude_agent_sdk" or name.startswith("claude_agent_sdk.") for name in names):
                found.append((node.lineno, isinstance(parent, ast.Module)))
    return found


def test_no_module_imports_the_sdk_at_module_level_and_only_the_engine_imports_it_at_all():
    offenders = {}
    for path in APP_DIR.rglob("*.py"):
        imports = _imports(path)
        if not imports:
            continue
        relative = path.relative_to(APP_DIR).as_posix()
        if relative != "chat/sdk_engine.py" or any(top for _, top in imports):
            offenders[relative] = imports

    assert offenders == {}


def test_the_ast_scan_looks_at_imports_not_at_words(tmp_path):
    """The scan ignores strings and comments (O8): the package name in text is not an import."""
    probe = tmp_path / "probe.py"
    probe.write_text('"""claude_agent_sdk in a docstring"""\nNAME = "import claude_agent_sdk"\n'
                     "# import claude_agent_sdk\nimport importlib\nimportlib.import_module('claude_agent_sdk')\n",
                     encoding="utf-8")

    assert _imports(probe) == []
    probe.write_text("def f():\n    import claude_agent_sdk\n", encoding="utf-8")
    assert _imports(probe) == [(2, False)]
    probe.write_text("from claude_agent_sdk.types import X\n", encoding="utf-8")
    assert _imports(probe) == [(1, True)]


def test_the_sdk_grep_of_the_verification_plan_is_empty():
    """F1.5 command 5, as a test: no line of `app/` outside sdk_engine.py names the package,
    except an `import_module` call."""
    hits = []
    for path in APP_DIR.rglob("*.py"):
        if path.relative_to(APP_DIR).as_posix() == "chat/sdk_engine.py":
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if "claude_agent_sdk" in line and "import_module" not in line:
                hits.append(f"{path.name}:{number}")
    assert hits == []
