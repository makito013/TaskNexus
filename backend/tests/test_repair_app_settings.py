"""Tests for backend/scripts/repair_app_settings.py.

The defect (a page copy) cannot be produced by SQL because of the CHECK and the
column affinity, so the fixture copies the raw bytes of the `global_agents` root
page over the `app_settings` root page, exactly like the corruption seen in
production. Nothing mocks SQLite. An autouse guard makes any test that tries to
open a database outside `tmp_path` (or a real `sessions.db`) fail loudly.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "repair_app_settings.py"
_spec = importlib.util.spec_from_file_location("repair_app_settings", SCRIPT)
rs = importlib.util.module_from_spec(_spec)
sys.modules["repair_app_settings"] = rs
_spec.loader.exec_module(rs)

FAKE_TOKEN = "sk-fake-0123456789"
PAGE_SIZE = 4096
AGENT_IDS = ["agent-a", "agent-b", "agent-c", "agent-d", "agent-e", "agent-f"]
INVALID_START = "1700000000.25"


# --------------------------------------------------------------------- guard

def _forbidden_paths() -> set[str]:
    here = Path(__file__).resolve()
    roots = {here.parents[2]}  # the checkout (or worktree) this test runs in
    for parent in here.parents:  # the main checkout that hosts .claude/worktrees
        if parent.name == ".claude":
            roots.add(parent.parent)
    paths = {os.path.normcase(os.path.realpath(r / "backend" / "sessions.db")) for r in roots}
    local = os.environ.get("LOCALAPPDATA")
    if local:
        paths.add(os.path.normcase(os.path.realpath(os.path.join(local, "TaskNexus"))))
    return paths


def _target_path(database) -> str | None:
    text = os.fspath(database)
    if text == ":memory:":
        return None
    if text.startswith("file:"):
        path = unquote(urlparse(text).path)
        if len(path) > 2 and path[0] == "/" and path[2] == ":":
            path = path[1:]
        return os.path.normcase(os.path.realpath(path))
    return os.path.normcase(os.path.realpath(text))


@pytest.fixture(autouse=True)
def never_touch_real_database(tmp_path, monkeypatch):
    real_connect = sqlite3.connect
    allowed = os.path.normcase(os.path.realpath(tmp_path))
    forbidden = _forbidden_paths()

    def guarded(database, *args, **kwargs):
        target = _target_path(database)
        if target is not None:
            if any(target == f or target.startswith(f + os.sep) for f in forbidden):
                raise AssertionError(f"test tried to open a real database: {target}")
            if not (target == allowed or target.startswith(allowed + os.sep)):
                raise AssertionError(f"test tried to open a database outside tmp_path: {target}")
        return real_connect(database, *args, **kwargs)

    monkeypatch.setattr(sqlite3, "connect", guarded)
    yield real_connect


# ------------------------------------------------------------------- fixture

def _create_schema(conn):
    conn.execute(
        "CREATE TABLE app_settings (id INTEGER PRIMARY KEY CHECK (id = 1), "
        "layout_version TEXT NOT NULL DEFAULT 'v1', theme_mode TEXT NOT NULL DEFAULT 'dark', "
        "updated_at REAL)")
    for column in ("projects_root_path TEXT", "quiet_hours_enabled INTEGER NOT NULL DEFAULT 0",
                   "quiet_hours_start TEXT NOT NULL DEFAULT '22:00'",
                   "quiet_hours_end TEXT NOT NULL DEFAULT '07:00'"):
        conn.execute(f"ALTER TABLE app_settings ADD COLUMN {column}")
    conn.execute(
        "CREATE TABLE global_agents (id TEXT PRIMARY KEY, nome TEXT NOT NULL, papel TEXT NOT NULL, "
        "ia TEXT NOT NULL, cmd TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL)")
    conn.execute("ALTER TABLE global_agents ADD COLUMN env TEXT")
    conn.execute("CREATE TABLE cards (id INTEGER PRIMARY KEY, title TEXT)")
    conn.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, note TEXT)")


def build_fixture(path: Path, *, big_env: bool = False, wal: bool = False,
                  intruder_env: dict | None = None, start: str = INVALID_START,
                  copy_page: bool = True) -> Path:
    """Database with the production defect: app_settings holds stale images of
    global_agents rows 2..6 plus a non-HH:MM quiet_hours_start on row 1."""
    conn = sqlite3.connect(str(path))
    _create_schema(conn)
    conn.execute("INSERT INTO app_settings (id, layout_version, theme_mode, updated_at) "
                 "VALUES (1, 'v2', 'dark', 1731500000.0)")
    for index, agent_id in enumerate(AGENT_IDS):
        env = {"CLAUDE_CONFIG_DIR": f"/fake/{agent_id}"}
        if intruder_env is not None and index == 2:
            env = intruder_env
        if big_env and index == 3:
            env = {"BLOB": "x" * 9000}
        conn.execute(
            "INSERT INTO global_agents (id, nome, papel, ia, cmd, created_at, updated_at, env) "
            "VALUES (?, ?, 'dev', 'claude', ?, 1700000000.5, 1700000001.5, ?)",
            (agent_id, f"Agent {index}", json.dumps(["claude"]), json.dumps(env)))
    for number in range(20):
        conn.execute("INSERT INTO cards (title) VALUES (?)", (f"card {number}",))
    conn.commit()
    roots = dict(conn.execute(
        "SELECT name, rootpage FROM sqlite_master WHERE name IN ('app_settings','global_agents')"))
    conn.close()
    if copy_page:
        data = bytearray(path.read_bytes())
        src, dst = roots["global_agents"], roots["app_settings"]
        data[(dst - 1) * PAGE_SIZE: dst * PAGE_SIZE] = data[(src - 1) * PAGE_SIZE: src * PAGE_SIZE]
        path.write_bytes(bytes(data))
    conn = sqlite3.connect(str(path))
    conn.execute(
        "UPDATE app_settings SET layout_version='v2', theme_mode='dark', updated_at=1731500000.0, "
        "projects_root_path='C:\\example', quiet_hours_enabled=0, quiet_hours_start=?, "
        "quiet_hours_end='07:00' WHERE id = 1", (start,))
    # the real secret lives only in global_agents, never in the copied page
    conn.execute("UPDATE global_agents SET env = ? WHERE id = ?",
                 (json.dumps({"API_TOKEN": FAKE_TOKEN}), AGENT_IDS[0]))
    conn.commit()
    if wal:
        conn.execute("PRAGMA journal_mode=WAL")
    conn.close()
    return path


def make_pins(db: Path, out: Path) -> Path:
    conn = sqlite3.connect(str(db))
    rows = conn.execute("SELECT * FROM app_settings WHERE id <> 1 ORDER BY id").fetchall()
    conn.close()
    pins = {"rows": [{"rowid": r[0], "agent_id": AGENT_IDS[r[0] - 1],
                      "values_sha256": rs.pin_digest(r)} for r in rows]}
    out.write_text(json.dumps(pins))
    return out


def logical_state(db: Path) -> dict:
    conn = sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True)
    try:
        names = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        return {n: conn.execute(f'SELECT * FROM "{n}" ORDER BY rowid').fetchall() for n in names}
    finally:
        conn.close()


def read(db: Path, sql: str):
    conn = sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True)
    try:
        return conn.execute(sql).fetchall()
    finally:
        conn.close()


class Env:
    """One test's database, pins and backup folder."""

    def __init__(self, tmp_path: Path, **fixture_kwargs):
        self.root = tmp_path
        self.db = build_fixture(tmp_path / "sessions.db", **fixture_kwargs)
        self.pins = make_pins(self.db, tmp_path / "pins.json")
        self.backup_dir = tmp_path / "backups"
        self.acl_calls: list[tuple[str, list[str]]] = []

    def fake_acl(self, path):
        self.acl_calls.append((str(path), os.listdir(path)))

    def run(self, *extra, ports=(), acl=None, pins=True, apply=False, db=None):
        argv = ["--db", str(db or self.db), "--backup-dir", str(self.backup_dir)]
        if pins:
            argv += ["--pins", str(self.pins)]
        if apply:
            argv.append("--apply")
        return rs.main(argv + list(extra), ports=ports, private_acl=acl or self.fake_acl)

    def apply(self, **kwargs):
        return self.run(apply=True, **kwargs)

    def run_dirs(self) -> list[Path]:
        return sorted(self.backup_dir.glob("run-*")) if self.backup_dir.exists() else []

    def latest_report(self) -> dict:
        return json.loads((self.run_dirs()[-1] / "report.json").read_text())


@pytest.fixture
def env(tmp_path):
    return Env(tmp_path)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ------------------------------------------------------------ pure functions

@pytest.mark.parametrize("value,valid", [
    ("22:00", True), ("00:00", True), ("23:59", True), ("07:05", True), (" 22:00 ", True),
    ("7:00", False), ("24:00", False), ("22:60", False), ("22:00:00", False),
    ("1700000000.25", False), ("", False), (None, False), (1700000000.25, False),
])
def test_time_validator_matches_the_app_format(value, valid):
    assert rs.is_valid_time(value) is valid


def test_pin_digest_is_stable_and_type_sensitive():
    assert rs.pin_digest((2, "a", 1.5)) == rs.pin_digest((2, "a", 1.5))
    assert rs.pin_digest((2, "1", None)) != rs.pin_digest((2, 1, None))
    assert rs.pin_digest((2, 1.0, None)) != rs.pin_digest((2, 1, None))
    assert rs.pin_digest((2, "a")) != rs.pin_digest((3, "a"))


def test_sddl_check_accepts_only_a_protected_acl_for_the_user_sid():
    sid = "S-1-5-21-1-2-3-1001"
    assert rs.sddl_is_private(f"D:PAI(A;OICI;FA;;;{sid})", sid)
    assert not rs.sddl_is_private(f"D:PAI(A;OICI;FA;;;{sid})(A;OICI;FA;;;WD)", sid)
    assert not rs.sddl_is_private(f"D:PAI(A;OICI;FA;;;{sid})(A;OICI;0x1200a9;;;S-1-5-11)", sid)
    assert not rs.sddl_is_private(f"D:AI(A;OICI;FA;;;{sid})", sid)  # not protected
    assert not rs.sddl_is_private(f"D:PAI(D;OICI;FA;;;{sid})", sid)  # deny ACE
    assert not rs.sddl_is_private("D:P", sid)


# ------------------------------------------------------------ the fixture

def test_fixture_reproduces_the_production_defect(env):
    messages = [r[0] for r in read(env.db, "PRAGMA integrity_check(1000)")]
    assert any("NUMERIC value in app_settings.quiet_hours_start" in m for m in messages)
    rows = read(env.db, "SELECT id FROM app_settings ORDER BY id")
    assert [r[0] for r in rows] == [1, 2, 3, 4, 5, 6]
    assert read(env.db, "SELECT quiet_hours_start FROM app_settings WHERE id = 1") == [(INVALID_START,)]


def test_fixture_is_unreadable_to_the_guard_for_real_paths():
    real = Path(__file__).resolve().parents[1] / "sessions.db"
    with pytest.raises(AssertionError):
        sqlite3.connect(str(real))
    with pytest.raises(AssertionError):
        sqlite3.connect(real.resolve().as_uri() + "?mode=ro", uri=True)


# ---------------------------------------------------------------- rehearsal

def test_rehearsal_does_not_touch_the_source_and_cleans_its_copy(tmp_path, capsys):
    env = Env(tmp_path)
    before_sha, before_mtime = sha(env.db), env.db.stat().st_mtime_ns
    assert env.run() == 0
    assert (sha(env.db), env.db.stat().st_mtime_ns) == (before_sha, before_mtime)
    run = env.run_dirs()[-1]
    assert not list(run.glob("*.db*"))  # no copy of the database (credentials) survives a rehearsal
    report = env.latest_report()
    assert report["backup"]["snapshot_deleted"] is True
    assert report["outcome"] == "rehearsed" and report["exit_code"] == 0
    assert report["rehearsal"]["integrity_check"] == "ok"
    assert report["backup"]["integrity_messages"] == 10
    assert report["backup"]["integrity_messages_all_about_app_settings"] is True
    assert "outcome: rehearsed" in capsys.readouterr().out


def test_rehearsal_on_a_wal_database_keeps_the_data(tmp_path):
    env = Env(tmp_path, wal=True)
    before = logical_state(env.db)
    assert env.run() == 0
    assert logical_state(env.db) == before


# ------------------------------------------------------------------- apply

@pytest.mark.parametrize("wal", [False, True], ids=["delete-journal", "wal"])
def test_apply_repairs_only_app_settings(tmp_path, wal):
    env = Env(tmp_path, wal=wal)
    before = logical_state(env.db)
    freelist_before = read(env.db, "PRAGMA freelist_count")
    page_count_before = read(env.db, "PRAGMA page_count")
    assert env.apply() == 0
    after = logical_state(env.db)
    assert read(env.db, "PRAGMA integrity_check(1000)") == [("ok",)]
    assert [r[0] for r in after["app_settings"]] == [1]
    row = after["app_settings"][0]
    old = before["app_settings"][0]
    assert row[6] == "22:00"
    assert row[:6] == old[:6] and row[7] == old[7]  # everything but quiet_hours_start
    for table in before:
        if table != "app_settings":
            assert after[table] == before[table], table
    assert read(env.db, "PRAGMA freelist_count") == freelist_before
    assert read(env.db, "PRAGMA page_count") == page_count_before
    run = env.run_dirs()[-1]
    backup = run / rs.BACKUP_NAME
    assert sha(backup) == (run / (rs.BACKUP_NAME + ".sha256")).read_text().split()[0]
    assert len(read(backup, "SELECT * FROM app_settings")) == 6
    report = env.latest_report()
    assert report["outcome"] == "applied" and report["repair"]["deleted"] == 5
    assert report["backup"]["integrity_messages"] == 10
    assert not list(run.glob("rehearsal.db*"))


def test_apply_keeps_a_valid_start_time(tmp_path):
    env = Env(tmp_path, start="21:30")
    assert env.apply() == 0
    assert read(env.db, "SELECT count(*), min(quiet_hours_start) FROM app_settings") == [(1, "21:30")]
    assert env.latest_report()["repair"]["start_updated"] is False


def test_second_apply_is_already_clean_and_makes_no_backup(tmp_path, capsys):
    env = Env(tmp_path)
    assert env.apply() == 0
    runs = env.run_dirs()
    state = logical_state(env.db)
    assert env.apply() == 0
    assert env.run_dirs() == runs
    assert logical_state(env.db) == state
    assert "already clean" in capsys.readouterr().out


def test_report_compares_intruders_with_global_agents_without_values(tmp_path):
    env = Env(tmp_path)
    conn = sqlite3.connect(str(env.db))
    conn.execute("UPDATE global_agents SET cmd = ? WHERE id = 'agent-c'", (json.dumps(["other"]),))
    conn.commit()
    conn.close()
    assert env.apply() == 0
    ca03 = {e["rowid"]: e for e in env.latest_report()["ca03"]}
    assert set(ca03) == {2, 3, 4, 5, 6}
    assert [k for k, v in ca03[3]["fields"].items() if v == "different"] == ["cmd"]
    assert all(v == "equal" for r in (2, 4, 5, 6) for v in ca03[r]["fields"].values())
    assert ca03[2]["env"] == {"intruder_keys": ["CLAUDE_CONFIG_DIR"],
                              "agents_keys": ["CLAUDE_CONFIG_DIR"], "equal": True}
    assert "/fake/agent-b" not in (env.run_dirs()[-1] / "report.json").read_text()


def test_secrets_never_reach_output_or_support_files(tmp_path, capsys):
    env = Env(tmp_path)
    assert env.apply() == 0
    captured = capsys.readouterr()
    assert FAKE_TOKEN not in captured.out + captured.err
    run = env.run_dirs()[-1]
    for path in run.iterdir():
        if path.name != rs.BACKUP_NAME:
            assert FAKE_TOKEN.encode() not in path.read_bytes(), path.name
    assert FAKE_TOKEN not in env.pins.read_text()
    assert FAKE_TOKEN.encode() in (run / rs.BACKUP_NAME).read_bytes()  # the backup is the one place


def test_output_is_ascii_only(tmp_path, capsys):
    env = Env(tmp_path)
    env.apply()
    assert capsys.readouterr().out.isascii()


# --------------------------------------------------------------- lock + ports

def test_apply_refuses_while_another_connection_is_open(tmp_path):
    env = Env(tmp_path, wal=True)
    other = sqlite3.connect(str(env.db))
    other.execute("SELECT count(*) FROM app_settings").fetchall()  # idle, no transaction
    before = logical_state(env.db)
    assert env.apply() == 2
    assert env.run_dirs() == []
    assert logical_state(env.db) == before
    other.close()
    assert env.apply() == 0  # the failed attempt did not leave the lock held


def test_apply_refuses_when_an_app_port_is_open(tmp_path):
    import socket
    env = Env(tmp_path)
    before = logical_state(env.db)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        assert env.apply(ports=(listener.getsockname()[1],)) == 2
    assert env.run_dirs() == [] and logical_state(env.db) == before


# ------------------------------------------------------------ preconditions

def _assert_refused_untouched(env, code=3, **kwargs):
    before = logical_state(env.db)
    assert env.apply(**kwargs) == code
    assert logical_state(env.db) == before


def test_apply_refuses_when_a_pinned_row_changed(tmp_path):
    env = Env(tmp_path)
    pins = json.loads(env.pins.read_text())
    pins["rows"][1]["values_sha256"] = "0" * 64
    env.pins.write_text(json.dumps(pins))
    _assert_refused_untouched(env)


def test_apply_refuses_when_the_row_set_differs_from_the_pins(tmp_path):
    env = Env(tmp_path)
    pins = json.loads(env.pins.read_text())
    pins["rows"] = pins["rows"][:-1]
    env.pins.write_text(json.dumps(pins))
    _assert_refused_untouched(env)


def test_apply_refuses_an_intruder_env_with_a_secret_looking_key(tmp_path):
    env = Env(tmp_path, intruder_env={"MY_API_TOKEN": "not-a-real-token"})
    _assert_refused_untouched(env)


def test_apply_refuses_when_quiet_hours_end_is_invalid(tmp_path):
    env = Env(tmp_path)
    conn = sqlite3.connect(str(env.db))
    conn.execute("UPDATE app_settings SET quiet_hours_end = 'soon' WHERE id = 1")
    conn.commit()
    conn.close()
    _assert_refused_untouched(env)


def test_apply_refuses_when_the_schema_changed(tmp_path):
    env = Env(tmp_path)
    conn = sqlite3.connect(str(env.db))
    conn.execute("ALTER TABLE app_settings ADD COLUMN extra TEXT")
    conn.commit()
    conn.close()
    _assert_refused_untouched(env)


def test_precondition_failure_keeps_the_backup_and_warns(tmp_path, capsys):
    env = Env(tmp_path)
    pins = json.loads(env.pins.read_text())
    pins["rows"][0]["values_sha256"] = "f" * 64
    env.pins.write_text(json.dumps(pins))
    assert env.apply() == 3
    assert (env.run_dirs()[-1] / rs.BACKUP_NAME).exists()
    assert "backup kept" in capsys.readouterr().out


# ---------------------------------------------------- failures before COMMIT

def test_overflow_cell_is_stopped_before_commit(tmp_path):
    env = Env(tmp_path, big_env=True)
    before = logical_state(env.db)
    assert env.apply() == 4
    assert logical_state(env.db) == before
    assert not list(env.run_dirs()[-1].glob("rehearsal.db*"))


def _fault_on_second_call(monkeypatch, fault):
    """repair() is called first on the rehearsal copy, then on the real database:
    only the real one misbehaves, so only the real pre-COMMIT checks can catch it."""
    original = rs.repair
    calls = []

    def faulty(conn, pins, *args, **kwargs):
        calls.append(1)
        result = original(conn, pins, *args, **kwargs)
        if len(calls) == 2:
            fault(conn)
        return result

    monkeypatch.setattr(rs, "repair", faulty)


def test_pre_commit_checks_roll_back_a_stray_delete_in_another_table(tmp_path, monkeypatch):
    env = Env(tmp_path, wal=True)
    _fault_on_second_call(monkeypatch, lambda c: c.execute("DELETE FROM cards WHERE id = 1"))
    _assert_refused_untouched(env, code=4)
    assert env.latest_report()["checks_failed"] == ["table:cards"]


def test_pre_commit_checks_roll_back_a_changed_row_1(tmp_path, monkeypatch):
    env = Env(tmp_path)
    _fault_on_second_call(monkeypatch, lambda c: c.execute("UPDATE app_settings SET theme_mode='light' WHERE id=1"))
    _assert_refused_untouched(env, code=4)


def test_exception_inside_the_transaction_rolls_back(tmp_path, monkeypatch):
    env = Env(tmp_path)

    def boom(conn):
        raise RuntimeError("disk exploded")

    _fault_on_second_call(monkeypatch, boom)
    _assert_refused_untouched(env, code=4)


def test_dying_after_begin_leaves_the_database_as_it_was(tmp_path):
    env = Env(tmp_path, wal=True)
    before = logical_state(env.db)
    driver = tmp_path / "driver.py"
    driver.write_text(
        "import importlib.util, os, sys\n"
        f"spec = importlib.util.spec_from_file_location('r', {str(SCRIPT)!r})\n"
        "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n"
        "orig, calls = m.repair, []\n"
        "def dying(conn, pins, *a, **k):\n"
        "    calls.append(1); res = orig(conn, pins, *a, **k)\n"
        "    if len(calls) == 2: os._exit(9)\n"
        "    return res\n"
        "m.repair = dying\n"
        f"sys.exit(m.main(['--db', {str(env.db)!r}, '--pins', {str(env.pins)!r}, '--apply',"
        f" '--backup-dir', {str(env.backup_dir)!r}], ports=(), private_acl=lambda p: None))\n")
    result = subprocess.run([sys.executable, "-I", str(driver)], capture_output=True, text=True)
    assert result.returncode == 9
    assert logical_state(env.db) == before
    assert env.apply() == 0  # rerunning after the crash is safe
    assert read(env.db, "SELECT count(*) FROM app_settings") == [(1,)]


# --------------------------------------------------------- COMMIT + after it

class CommitFaultProxy:
    def __init__(self, conn, really_commit):
        self._conn, self._really = conn, really_commit

    def execute(self, sql, *args):
        if sql == "COMMIT":
            if self._really:
                self._conn.execute("COMMIT")
            raise sqlite3.OperationalError("disk I/O error")
        return self._conn.execute(sql, *args)

    def __getattr__(self, name):
        return getattr(self._conn, name)


def _inject_commit_fault(monkeypatch, really_commit):
    original = rs.acquire_exclusive
    monkeypatch.setattr(rs, "acquire_exclusive", lambda db: CommitFaultProxy(original(db), really_commit))


def test_failed_commit_that_did_not_happen_exits_4(tmp_path, monkeypatch):
    env = Env(tmp_path)
    _inject_commit_fault(monkeypatch, really_commit=False)
    _assert_refused_untouched(env, code=4)


def test_failed_commit_that_did_happen_is_classified_by_the_real_state(tmp_path, monkeypatch):
    env = Env(tmp_path)
    _inject_commit_fault(monkeypatch, really_commit=True)
    assert env.apply() == 0
    assert read(env.db, "SELECT count(*) FROM app_settings") == [(1,)]
    assert any("COMMIT raised" in w for w in env.latest_report()["warnings"])


def test_failed_check_after_commit_exits_5_and_never_1(tmp_path, monkeypatch):
    env = Env(tmp_path)
    monkeypatch.setattr(rs, "post_commit_verify", lambda db, counts: ["integrity_check"])
    assert env.apply() == 5
    assert read(env.db, "SELECT count(*) FROM app_settings") == [(1,)]  # it is committed
    assert env.latest_report()["outcome"] == "applied_unverified"


def test_exception_after_commit_exits_5_never_1(tmp_path, monkeypatch):
    env = Env(tmp_path)

    def boom(db, counts):
        raise MemoryError

    monkeypatch.setattr(rs, "post_commit_verify", boom)
    assert env.apply() == 5


def test_report_write_failure_after_commit_still_exits_0(tmp_path, monkeypatch, capsys):
    env = Env(tmp_path)
    original = Path.write_text

    def failing(self, *args, **kwargs):
        if self.name == "report.json":
            raise OSError("disk full")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", failing)
    assert env.apply() == 0
    assert read(env.db, "SELECT count(*) FROM app_settings") == [(1,)]
    assert "could not write report.json" in capsys.readouterr().out


def test_rehearsal_copy_that_cannot_be_deleted_is_only_a_warning(tmp_path, monkeypatch):
    env = Env(tmp_path)
    original = Path.unlink

    def failing(self, *args, **kwargs):
        if self.name == "rehearsal.db":
            raise PermissionError("antivirus")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", failing)
    assert env.apply() == 0
    assert any("rehearsal.db" in w for w in env.latest_report()["warnings"])


# --------------------------------------------------------------- private ACL

def test_private_folders_are_prepared_before_any_file_is_written(tmp_path):
    env = Env(tmp_path)
    assert env.apply() == 0
    paths = [Path(p).name for p, _ in env.acl_calls]
    assert paths[0] == "backups" and paths[-1].startswith("run-")
    assert all(listing == [] for _, listing in env.acl_calls)


def test_acl_failure_stops_before_any_backup(tmp_path):
    env = Env(tmp_path)

    def failing_acl(path):
        raise RuntimeError("folder ACL is not private")

    before = logical_state(env.db)
    assert env.apply(acl=failing_acl) == 1
    assert logical_state(env.db) == before
    assert not list(env.backup_dir.rglob("*.db"))


@pytest.mark.skipif(sys.platform != "win32", reason="Windows ACLs")
def test_real_acl_leaves_only_the_current_user(tmp_path):
    folder = tmp_path / "private"
    folder.mkdir()
    rs.apply_private_acl(folder)  # raises if the ACL is not private or not writable
    listing = subprocess.run([rs._system32("icacls.exe"), str(folder)], capture_output=True, text=True).stdout
    for forbidden in ("Everyone", "Users", "Authenticated Users"):
        assert forbidden not in listing.replace(str(folder), "")
    (folder / "x.txt").write_text("still writable")


# --------------------------------------------------------------- rollback

def _applied(tmp_path):
    env = Env(tmp_path)
    assert env.apply() == 0
    return env, env.run_dirs()[-1] / rs.BACKUP_NAME


def test_rollback_restores_the_backup_exactly(tmp_path):
    env, backup = _applied(tmp_path)
    original = logical_state(backup)
    assert env.run("--rollback", str(backup), pins=False, apply=True) == 0
    assert logical_state(env.db) == original
    assert any((d / rs.PRE_ROLLBACK_NAME).exists() for d in env.run_dirs())


def test_rollback_refuses_when_another_table_changed_since_the_backup(tmp_path):
    env, backup = _applied(tmp_path)
    conn = sqlite3.connect(str(env.db))
    conn.execute("INSERT INTO cards (title) VALUES ('written by the app after the repair')")
    conn.commit()
    conn.close()
    after_repair = logical_state(env.db)
    assert env.run("--rollback", str(backup), pins=False, apply=True) == 3
    assert logical_state(env.db) == after_repair


def test_rollback_refuses_a_backup_that_does_not_match_its_hash(tmp_path):
    env, backup = _applied(tmp_path)
    Path(str(backup) + ".sha256").write_text("0" * 64 + "  x\n")
    after_repair = logical_state(env.db)
    assert env.run("--rollback", str(backup), pins=False, apply=True) == 3
    assert logical_state(env.db) == after_repair


def test_rollback_refuses_when_the_app_port_is_open(tmp_path):
    import socket
    env, backup = _applied(tmp_path)
    after_repair = logical_state(env.db)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        assert env.run("--rollback", str(backup), pins=False, apply=True,
                       ports=(listener.getsockname()[1],)) == 2
    assert logical_state(env.db) == after_repair


# ----------------------------------------------------------------------- CLI

def _cli(*args):
    return subprocess.run([sys.executable, "-I", str(SCRIPT), *args], capture_output=True, text=True)


def test_cli_rejects_a_relative_db(tmp_path):
    env = Env(tmp_path)
    assert _cli("--db", "sessions.db", "--pins", str(env.pins)).returncode == 1


def test_cli_rejects_a_missing_db_without_creating_it(tmp_path):
    env = Env(tmp_path)
    missing = tmp_path / "nope.db"
    assert _cli("--db", str(missing), "--pins", str(env.pins), "--backup-dir", str(env.backup_dir)).returncode == 1
    assert not missing.exists()


def test_cli_rejects_an_empty_db(tmp_path):
    env = Env(tmp_path)
    empty = tmp_path / "empty.db"
    empty.write_bytes(b"")
    assert _cli("--db", str(empty), "--pins", str(env.pins)).returncode == 1


def test_cli_requires_pins_and_apply_for_rollback(tmp_path):
    env = Env(tmp_path)
    assert _cli("--db", str(env.db)).returncode == 1
    assert _cli("--db", str(env.db), "--rollback", str(tmp_path / "b.db")).returncode == 1


def test_cli_argparse_errors_exit_1_not_2(tmp_path):
    assert _cli("--no-such-flag").returncode == 1


def test_cli_rehearsal_end_to_end(tmp_path):
    env = Env(tmp_path)
    result = _cli("--db", str(env.db), "--pins", str(env.pins), "--backup-dir", str(env.backup_dir))
    assert result.returncode == 0, result.stdout + result.stderr
    assert "outcome: rehearsed" in result.stdout


def test_preconditions_are_checked_again_inside_the_transaction(tmp_path, monkeypatch):
    env = Env(tmp_path)
    original = rs.check_preconditions
    calls = []

    def changing(conn, pins):
        calls.append(1)
        return ["injected change"] if len(calls) == 2 else original(conn, pins)

    monkeypatch.setattr(rs, "check_preconditions", changing)
    _assert_refused_untouched(env, code=3)
    assert len(calls) == 2


def test_cli_rejects_a_relative_backup_dir(tmp_path):
    env = Env(tmp_path)
    assert _cli("--db", str(env.db), "--pins", str(env.pins), "--backup-dir", "backups").returncode == 1


def test_apply_refuses_when_global_agents_has_a_new_column(tmp_path):
    env = Env(tmp_path)
    conn = sqlite3.connect(str(env.db))
    conn.execute("ALTER TABLE global_agents ADD COLUMN extra TEXT")
    conn.commit()
    conn.close()
    _assert_refused_untouched(env)


def test_apply_refuses_a_pin_for_a_row_that_does_not_exist(tmp_path):
    env = Env(tmp_path)
    pins = json.loads(env.pins.read_text())
    pins["rows"].append({"rowid": 7, "agent_id": "agent-x", "values_sha256": "1" * 64})
    env.pins.write_text(json.dumps(pins))
    _assert_refused_untouched(env)


def test_rehearsal_leaves_no_credential_copy_in_any_file(tmp_path, capsys):
    env = Env(tmp_path)
    assert env.run() == 0
    captured = capsys.readouterr()
    assert FAKE_TOKEN not in captured.out + captured.err
    for path in env.run_dirs()[-1].iterdir():
        assert FAKE_TOKEN.encode() not in path.read_bytes(), path.name


def test_rehearsal_that_stops_on_a_precondition_leaves_no_database_copy(tmp_path):
    env = Env(tmp_path)
    pins = json.loads(env.pins.read_text())
    pins["rows"][0]["values_sha256"] = "f" * 64
    env.pins.write_text(json.dumps(pins))
    assert env.run() == 3
    assert not list(env.run_dirs()[-1].glob("*.db*"))


def test_rehearsal_that_fails_on_the_copy_leaves_no_database_copy(tmp_path):
    env = Env(tmp_path, big_env=True)
    assert env.run() == 4
    assert not list(env.run_dirs()[-1].glob("*.db*"))


def test_snapshot_that_cannot_be_deleted_is_only_a_warning(tmp_path, monkeypatch):
    env = Env(tmp_path)
    original = Path.unlink

    def failing(self, *args, **kwargs):
        if self.name == rs.SNAPSHOT_NAME:
            raise PermissionError("antivirus")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", failing)
    assert env.run() == 0
    assert any(rs.SNAPSHOT_NAME in w for w in env.latest_report()["warnings"])


# ------------------------------------------------------------------ QA additions

@pytest.mark.parametrize("change", [
    "UPDATE cards SET title = title || '~' WHERE id = 1",
    "UPDATE cards SET title = CAST(title AS BLOB) WHERE id = 1",
    "UPDATE cards SET id = id + 1000 WHERE id = 20",
])
def test_rollback_refuses_a_change_that_keeps_the_row_count(tmp_path, change):
    env, backup = _applied(tmp_path)
    conn = sqlite3.connect(str(env.db))
    conn.execute(change)
    conn.commit()
    conn.close()
    counts = rs_counts(env.db)
    after_repair = logical_state(env.db)
    counts.pop("app_settings")
    expected = rs_counts(backup)
    expected.pop("app_settings")
    assert counts == expected  # the change really preserves every other count
    assert env.run("--rollback", str(backup), pins=False, apply=True) == 3
    assert logical_state(env.db) == after_repair


def rs_counts(db: Path) -> dict:
    conn = sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True)
    try:
        return rs.table_counts(conn)
    finally:
        conn.close()


def test_corruption_outside_app_settings_never_reaches_the_database(tmp_path):
    """A message in another table (C3) must stop the run with nothing written."""
    env = Env(tmp_path)
    conn = sqlite3.connect(str(env.db))
    conn.execute("CREATE TABLE vapid_keys (id INTEGER PRIMARY KEY CHECK (id = 1), pem TEXT)")
    conn.execute("PRAGMA ignore_check_constraints = ON")
    conn.execute("INSERT INTO vapid_keys VALUES (2, 'x')")
    conn.commit()
    conn.close()
    before = logical_state(env.db)
    assert env.apply() == 4
    assert logical_state(env.db) == before
    assert env.latest_report()["backup"]["integrity_messages_all_about_app_settings"] is False
    assert not list(env.run_dirs()[-1].glob("rehearsal.db*"))
