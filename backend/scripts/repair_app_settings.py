"""Repair `app_settings` in the production `sessions.db` (one-off, stdlib only).

Context: page-level corruption left `app_settings` with extra rows (`id <> 1`,
stale images of `global_agents` rows) and a non-HH:MM `quiet_hours_start` on
row 1. This script removes the extra rows and rewrites only `quiet_hours_start`
(and only when it is invalid), in one transaction, after a verified backup and
a rehearsal on a copy of those very bytes.

It imports nothing from the app and carries no production data: the rows to
remove are identified by a pins file kept OUTSIDE the repository (see below).

Usage (PowerShell, a terminal NOT started from inside TaskNexus):

    $py = "$env:LOCALAPPDATA\\Programs\\Python\\Python312\\python.exe"
    # rehearsal (default): read-only on the database, safe with the app running
    & $py -I -u repair_app_settings.py --db <abs path to sessions.db> --pins <pins.json>
    # real write: the app MUST be stopped
    & $py -I -u repair_app_settings.py --db <...> --pins <pins.json> --apply
    # undo (app stopped, before the app writes again)
    & $py -I -u repair_app_settings.py --db <...> --rollback <RUN>\\sessions-pre-repair.db --apply

Pins file: {"rows": [{"rowid": 2, "agent_id": "<label>", "values_sha256": "<hex>"}, ...]}
where `values_sha256` is `pin_digest()` of the row (SQL values and storage
types, `id` included) and `agent_id` is only a label that points to the
counterpart row in `global_agents` (used by the in-memory CA03 comparison).

Exit codes:
  0  done, or nothing to do (`already_clean`), or rehearsal ok
  1  argument / environment error; nothing was written to the database
  2  lock denied or app still up (port open); nothing was written
  3  precondition or pin failed (or rollback refused); nothing was written
  4  verification failed before COMMIT; ROLLBACK done, nothing changed
  5  committed (or restored) but the check afterwards failed; look again with
     a read-only connection before deciding anything else

Safety rules baked in: the database is opened by URI (`mode=rw`, never creates
a file); `-wal`/`-shm` are never touched; the backup is never deleted; the
report never carries `env` values, table digests or the old invalid time.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_LOCKED = 2
EXIT_PRECONDITION = 3
EXIT_ROLLED_BACK = 4
EXIT_POST_COMMIT = 5

DEFAULT_QUIET_START = "22:00"
PROBE_PORTS = (443, 8765)
BACKUP_NAME = "sessions-pre-repair.db"
SNAPSHOT_NAME = "sessions-rehearsal-snapshot.db"
PRE_ROLLBACK_NAME = "sessions-pre-rollback.db"

# Same format as `parse_time_of_day` in the app (value is stripped first).
_TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_SECRET_KEY_PATTERN = re.compile(r"TOKEN|SECRET|PASSWORD|KEY|AUTH", re.IGNORECASE)

# Physical column order (ALTER ADD COLUMN appends at the end, so `env` is LAST
# in global_agents). An intruder row is a global_agents record read through the
# app_settings column layout, position by position.
APP_SETTINGS_COLUMNS = (
    "id", "layout_version", "theme_mode", "updated_at", "projects_root_path",
    "quiet_hours_enabled", "quiet_hours_start", "quiet_hours_end",
)
GLOBAL_AGENTS_COLUMNS = (
    "id", "nome", "papel", "ia", "cmd", "created_at", "updated_at", "env",
)
_ENV_POSITION = GLOBAL_AGENTS_COLUMNS.index("env")


class Abort(Exception):
    """A known stop condition, with the exit code it maps to."""

    def __init__(self, code: int, message: str, reason: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.reason = reason or message.split(":")[0][:60]


class _Parser(argparse.ArgumentParser):
    # argparse exits with 2 by default, which here means "app still up".
    def error(self, message: str) -> None:  # type: ignore[override]
        self.print_usage(sys.stderr)
        print(f"error: {message}", file=sys.stderr)
        raise SystemExit(EXIT_ERROR)


def say(message: str) -> None:
    print(message.encode("ascii", "backslashreplace").decode("ascii"), flush=True)


# --------------------------------------------------------------------- basics

def is_valid_time(value: object) -> bool:
    return isinstance(value, str) and _TIME_PATTERN.match(value.strip()) is not None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _value_token(value: object) -> list:
    if value is None:
        return ["null"]
    if isinstance(value, int):
        return ["integer", value]
    if isinstance(value, float):
        return ["real", repr(value)]
    if isinstance(value, bytes):
        return ["blob", value.hex()]
    return ["text", value]


def pin_digest(row: tuple) -> str:
    """SHA-256 of a row's SQL values and storage types (id included)."""
    payload = json.dumps([_value_token(v) for v in row], separators=(",", ":"))
    return hashlib.sha256(payload.encode("ascii")).hexdigest()


def db_uri(path: Path | str, mode: str, immutable: bool = False) -> str:
    uri = Path(path).resolve().as_uri() + f"?mode={mode}"
    return uri + "&immutable=1" if immutable else uri


def open_db(path: Path | str, mode: str, immutable: bool = False, timeout: float = 5.0):
    return sqlite3.connect(
        db_uri(path, mode, immutable), uri=True, timeout=timeout, isolation_level=None
    )


def open_ports(ports: tuple[int, ...]) -> list[int]:
    found = []
    for port in ports:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.settimeout(0.5)
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                found.append(port)
    return found


def messages(conn: sqlite3.Connection, pragma: str = "integrity_check") -> list[str]:
    return [row[0] for row in conn.execute(f"PRAGMA {pragma}(1000)")]


def pragma_int(conn: sqlite3.Connection, name: str) -> int:
    return conn.execute(f"PRAGMA {name}").fetchone()[0]


def table_names(conn: sqlite3.Connection) -> list[str]:
    return [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")]


def table_counts(conn: sqlite3.Connection) -> dict[str, int]:
    return {n: conn.execute(f'SELECT count(*) FROM "{n}"').fetchone()[0]
            for n in table_names(conn)}


def table_digest(conn: sqlite3.Connection, name: str) -> str:
    try:
        cursor = conn.execute(f'SELECT * FROM "{name}" ORDER BY rowid')
    except sqlite3.OperationalError:  # WITHOUT ROWID table
        cursor = conn.execute(f'SELECT * FROM "{name}"')
    digest = hashlib.sha256()
    for row in cursor:
        digest.update(json.dumps([_value_token(v) for v in row]).encode("ascii"))
    return digest.hexdigest()


def snapshot_tables(conn: sqlite3.Connection, skip: tuple[str, ...] = ()) -> dict:
    """{table: (row count, row digest)} for every table except `skip`."""
    return {
        n: (conn.execute(f'SELECT count(*) FROM "{n}"').fetchone()[0], table_digest(conn, n))
        for n in table_names(conn) if n not in skip
    }


# --------------------------------------------------------------- private ACL

def _system32(name: str) -> str:
    return os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", name)


def current_user_sid() -> str:
    out = subprocess.run(
        [_system32("whoami.exe"), "/user", "/fo", "csv", "/nh"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return out.split(",")[1].strip().strip('"')


def sddl_is_private(sddl: str, sid: str) -> bool:
    """True only for a protected DACL whose ACEs are all `allow` for `sid`."""
    match = re.search(r"D:(\w*?)((?:\([^)]*\))+)", sddl)
    if match is None or "P" not in match.group(1):
        return False
    aces = re.findall(r"\(([^)]*)\)", match.group(2))
    if not aces:
        return False
    for ace in aces:
        parts = ace.split(";")
        if len(parts) < 6 or parts[0] != "A" or parts[5] != sid:
            return False
    return True


def apply_private_acl(path: Path) -> None:
    """Make `path` readable/writable by the current user's SID only, prove it,
    and prove a file can be written there. SID based: names resolve wrongly."""
    if sys.platform != "win32":
        os.chmod(path, 0o700)
    else:
        sid = current_user_sid()
        icacls = _system32("icacls.exe")
        subprocess.run(
            [icacls, str(path), "/inheritance:r", "/grant:r", f"*{sid}:(OI)(CI)F"],
            capture_output=True, text=True, check=True,
        )
        handle, saved = tempfile.mkstemp(suffix=".acl")
        os.close(handle)
        try:
            subprocess.run([icacls, str(path), "/save", saved, "/c"],
                           capture_output=True, text=True, check=True)
            raw = Path(saved).read_bytes()
            # icacls writes UTF-16LE, usually without a BOM
            sddl = raw.decode("utf-16" if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-16-le")
        finally:
            os.unlink(saved)
        if not sddl_is_private(sddl, sid):
            raise RuntimeError("folder ACL is not private to the current user; refusing")
    probe = Path(path) / ".acl-probe"
    probe.write_text("ok")
    if probe.read_text() != "ok":
        raise RuntimeError("write probe failed in the private folder")
    probe.unlink()


# ----------------------------------------------------------------- pins / state

def load_pins(path: str) -> list[dict]:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        rows = data["rows"]
        pins = [{"rowid": int(r["rowid"]), "agent_id": str(r["agent_id"]),
                 "values_sha256": str(r["values_sha256"])} for r in rows]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise Abort(EXIT_ERROR, f"cannot read pins file: {type(exc).__name__}", "pins") from exc
    if len({p["rowid"] for p in pins}) != len(pins) or any(p["rowid"] == 1 for p in pins):
        raise Abort(EXIT_ERROR, "pins file has duplicate rowids or rowid 1", "pins")
    return pins


def read_intruders(conn: sqlite3.Connection) -> list[tuple]:
    return conn.execute("SELECT * FROM app_settings WHERE id <> 1 ORDER BY id").fetchall()


def read_state(conn: sqlite3.Connection) -> dict:
    row = conn.execute(
        "SELECT quiet_hours_start FROM app_settings WHERE id = 1").fetchone()
    return {
        "has_row1": row is not None,
        "start_valid": row is not None and is_valid_time(row[0]),
        "intruders": conn.execute(
            "SELECT count(*) FROM app_settings WHERE id <> 1").fetchone()[0],
    }


def _env_keys(value: object) -> list[str] | None:
    if value is None:
        return []
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return None
    return sorted(parsed) if isinstance(parsed, dict) else None


def check_preconditions(conn: sqlite3.Connection, pins: list[dict]) -> list[str]:
    """Problems that must stop the repair (no values in the messages)."""
    problems = []
    for table, expected in (("app_settings", APP_SETTINGS_COLUMNS),
                            ("global_agents", GLOBAL_AGENTS_COLUMNS)):
        columns = tuple(r[1] for r in conn.execute(f"PRAGMA table_info({table})"))
        if columns != expected:
            problems.append(f"{table} columns differ from the analysed layout")
    if pragma_int(conn, "auto_vacuum") != 0:
        problems.append("auto_vacuum is on")
    if problems:
        return problems
    row1 = conn.execute(
        "SELECT quiet_hours_enabled, quiet_hours_end FROM app_settings WHERE id = 1").fetchone()
    if row1 is None:
        return ["app_settings row 1 is missing"]
    if row1[0] not in (0, 1) or isinstance(row1[0], (float, str)):
        problems.append("quiet_hours_enabled on row 1 is not 0/1")
    if not is_valid_time(row1[1]):
        problems.append("quiet_hours_end on row 1 is not HH:MM")
    intruders = read_intruders(conn)
    if [r[0] for r in intruders] != sorted(p["rowid"] for p in pins):
        problems.append("rows with id <> 1 are not the pinned rowids")
    pinned = {p["rowid"]: p["values_sha256"] for p in pins}
    for row in intruders:
        if pinned.get(row[0]) != pin_digest(row):
            problems.append(f"pin mismatch on rowid {row[0]}")
        keys = _env_keys(row[_ENV_POSITION])
        if keys is None:
            problems.append(f"env of rowid {row[0]} is not a JSON object")
        elif any(_SECRET_KEY_PATTERN.search(k) for k in keys):
            problems.append(f"env of rowid {row[0]} has a key name that looks like a secret")
    return problems


def compare_with_agents(conn: sqlite3.Connection, pins: list[dict]) -> list[dict]:
    """CA03, in memory: intruder row vs its global_agents counterpart.
    Field NAMES and env key NAMES only, never values, sizes or hashes."""
    result = []
    for pin in pins:
        row = conn.execute("SELECT * FROM app_settings WHERE id = ?", (pin["rowid"],)).fetchone()
        agent = conn.execute(
            "SELECT * FROM global_agents WHERE id = ?", (pin["agent_id"],)).fetchone()
        entry = {"rowid": pin["rowid"], "agent_id": pin["agent_id"],
                 "counterpart": "present" if agent else "absent"}
        if agent and row:
            entry["fields"] = {
                GLOBAL_AGENTS_COLUMNS[i]: (
                    "equal" if type(row[i]) is type(agent[i]) and row[i] == agent[i] else "different")
                for i in range(1, _ENV_POSITION)
            }
            entry["env"] = {
                "intruder_keys": _env_keys(row[_ENV_POSITION]),
                "agents_keys": _env_keys(agent[_ENV_POSITION]),
                "equal": row[_ENV_POSITION] == agent[_ENV_POSITION],
            }
        result.append(entry)
    return result


# ----------------------------------------------------------- repair + checks

def row1_without_start(conn: sqlite3.Connection) -> tuple:
    names = [c for c in APP_SETTINGS_COLUMNS if c != "quiet_hours_start"]
    return conn.execute(f"SELECT {', '.join(names)} FROM app_settings WHERE id = 1").fetchone()


def capture(conn: sqlite3.Connection) -> dict:
    return {
        "tables": snapshot_tables(conn, skip=("app_settings",)),
        "freelist": pragma_int(conn, "freelist_count"),
        "page_count": pragma_int(conn, "page_count"),
        "row1": row1_without_start(conn),
    }


def repair(conn: sqlite3.Connection, pins: list[dict], quiet_start: str = DEFAULT_QUIET_START) -> dict:
    deleted = conn.execute("DELETE FROM app_settings WHERE id <> 1").rowcount
    if deleted != len(pins):
        raise Abort(EXIT_ROLLED_BACK, f"delete touched {deleted} rows, expected {len(pins)}", "rowcount")
    start = conn.execute("SELECT quiet_hours_start FROM app_settings WHERE id = 1").fetchone()[0]
    start_was_invalid = not is_valid_time(start)
    if start_was_invalid:
        updated = conn.execute(
            "UPDATE app_settings SET quiet_hours_start = ? WHERE id = 1", (quiet_start,)).rowcount
        if updated != 1:
            raise Abort(EXIT_ROLLED_BACK, f"update touched {updated} rows, expected 1", "rowcount")
    return {"deleted": deleted, "start_was_invalid": start_was_invalid,
            "start_updated": start_was_invalid}


def verify_before_commit(conn: sqlite3.Connection, before: dict) -> list[str]:
    """Names of the checks that failed (empty list = safe to COMMIT)."""
    failed = []
    if messages(conn) != ["ok"]:
        failed.append("integrity_check")
    if messages(conn, "quick_check") != ["ok"]:
        failed.append("quick_check")
    count, low = conn.execute("SELECT count(*), min(id) FROM app_settings").fetchone()
    if (count, low) != (1, 1):
        failed.append("app_settings_single_row")
    start, end, enabled = conn.execute(
        "SELECT quiet_hours_start, quiet_hours_end, quiet_hours_enabled "
        "FROM app_settings WHERE id = 1").fetchone()
    if not (is_valid_time(start) and is_valid_time(end)):
        failed.append("quiet_hours_format")
    if enabled not in (0, 1):
        failed.append("quiet_hours_enabled")
    if row1_without_start(conn) != before["row1"]:
        failed.append("row1_other_columns")
    if pragma_int(conn, "freelist_count") != before["freelist"]:
        failed.append("freelist_delta")
    if pragma_int(conn, "page_count") != before["page_count"]:
        failed.append("page_count_delta")
    after = snapshot_tables(conn, skip=("app_settings",))
    for name in sorted(set(after) | set(before["tables"])):
        if after.get(name) != before["tables"].get(name):
            failed.append(f"table:{name}")
    return failed


def rehearse(backup_path: Path, run_dir: Path, pins: list[dict], rep: "Report",
             live_messages: list[str] | None = None) -> None:
    """Run the same repair on a copy of the backup; the copy is always deleted.

    The copy is opened read-write, like the locked database, because a read-only
    connection reports fewer integrity messages (the CHECK ones are missing).
    With `live_messages` (locked database) the copy must report the same."""
    copy = run_dir / "rehearsal.db"
    conn = None
    try:
        shutil.copyfile(backup_path, copy)
        conn = open_db(copy, "rw")
        conn.execute("PRAGMA journal_mode=DELETE")
        found = messages(conn)
        if live_messages is not None and sorted(found) != sorted(live_messages):
            raise Abort(EXIT_ERROR, "backup integrity messages differ from the locked database", "backup")
        rep.data["backup"]["integrity_messages"] = 0 if found == ["ok"] else len(found)
        rep.data["backup"]["integrity_messages_all_about_app_settings"] = all("app_settings" in m for m in found)
        if found != ["ok"] and not all("app_settings" in m for m in found):
            rep.warn("integrity messages that are not about app_settings: see the repair checks below")
        conn.execute("BEGIN IMMEDIATE")
        before = capture(conn)
        info = repair(conn, pins)
        failed = verify_before_commit(conn, before)
        if failed:
            conn.execute("ROLLBACK")
            raise Abort(EXIT_ROLLED_BACK, "rehearsal failed checks: " + ", ".join(failed), "rehearsal")
        conn.execute("COMMIT")
        if messages(conn) != ["ok"]:
            raise Abort(EXIT_ROLLED_BACK, "rehearsal copy is not ok after commit", "rehearsal")
        rep.data["rehearsal"] = {"integrity_check": "ok", **info}
    except sqlite3.Error as exc:
        # e.g. an overflow chain that the DELETE freed while another table still uses it
        raise Abort(EXIT_ROLLED_BACK, f"rehearsal failed on the copy ({type(exc).__name__}); nothing was written", "rehearsal") from exc
    finally:
        if conn is not None:
            conn.close()
        leftovers = [copy, *(copy.with_name(copy.name + s) for s in ("-wal", "-shm", "-journal"))]
        for leftover in leftovers:
            try:
                leftover.unlink(missing_ok=True)
            except OSError as exc:
                rep.warn(f"could not delete {leftover.name}: {type(exc).__name__}; delete it by hand")


# ------------------------------------------------------------------- report

class Report:
    def __init__(self) -> None:
        self.data: dict = {"warnings": [], "outcome": "started", "sqlite_version": sqlite3.sqlite_version,
                           "python": sys.version.split()[0]}
        self.run_dir: Path | None = None
        self.committed = False
        self.in_transaction = False

    def warn(self, text: str) -> None:
        self.data["warnings"].append(text)
        say("warning: " + text)

    def finish(self, code: int) -> None:
        self.data["exit_code"] = code
        self.data["finished"] = datetime.now().isoformat(timespec="seconds")
        if self.run_dir is not None:
            try:
                (self.run_dir / "report.json").write_text(
                    json.dumps(self.data, indent=2, default=str), encoding="ascii")
            except OSError as exc:
                say(f"warning: could not write report.json: {type(exc).__name__}")
        say(f"outcome: {self.data['outcome']}")
        if self.run_dir is not None:
            say(f"RUN: {self.run_dir}")
        say(f"exit={code}")


def discard_snapshot(snapshot: Path, rep: Report) -> None:
    """A rehearsal leaves no copy of the database behind (it holds credentials);
    only the `--apply` backup stays. Failing to delete is a warning, never an exit code."""
    for leftover in (snapshot, Path(str(snapshot) + ".sha256")):
        try:
            leftover.unlink(missing_ok=True)
        except OSError as exc:
            rep.warn(f"could not delete {leftover.name}: {type(exc).__name__}; delete it by hand")
    rep.data.setdefault("backup", {})["snapshot_deleted"] = not snapshot.exists()


def make_run_dir(base: Path, private_acl, rep: Report) -> Path:
    base.mkdir(parents=True, exist_ok=True)
    private_acl(base)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    suffix = 0
    while True:
        run_dir = base / f"run-{stamp}-{os.getpid()}{'' if suffix == 0 else '-' + str(suffix)}"
        try:
            run_dir.mkdir()
            break
        except FileExistsError:
            suffix += 1
    private_acl(run_dir)
    rep.run_dir = run_dir
    return run_dir


# ---------------------------------------------------------------- lock/backup

def acquire_exclusive(db: Path) -> sqlite3.Connection:
    """The real gate: with EXCLUSIVE locking, the first read fails if ANY other
    connection is open, even idle. Always closes on failure (a leaked failed
    attempt would keep denying the next ones)."""
    conn = None
    try:
        conn = open_db(db, "rw", timeout=1.0)
        conn.execute("PRAGMA locking_mode=EXCLUSIVE")
        conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
        if conn.execute("PRAGMA locking_mode").fetchone()[0].lower() != "exclusive":
            raise Abort(EXIT_LOCKED, "could not get exclusive locking mode", "lock")
        conn.execute("PRAGMA synchronous=FULL")
        return conn
    except sqlite3.OperationalError as exc:
        if conn is not None:
            conn.close()
        text = str(exc).lower()
        if "locked" in text or "busy" in text:
            raise Abort(EXIT_LOCKED, "database is locked: stop the app and any other opener, then run again", "lock") from exc
        raise Abort(EXIT_ERROR, f"cannot open the database: {exc}", "open") from exc
    except sqlite3.DatabaseError as exc:
        if conn is not None:
            conn.close()
        raise Abort(EXIT_ERROR, f"cannot open the database: {exc}", "open") from exc
    except BaseException:
        if conn is not None:
            conn.close()
        raise


def backup_to(conn: sqlite3.Connection, dst: Path) -> None:
    target = sqlite3.connect(str(dst))
    try:
        conn.backup(target)
    finally:
        target.close()


def write_sha_file(path: Path, digest: str) -> None:
    Path(str(path) + ".sha256").write_text(f"{digest}  {path.name}\n", encoding="ascii")


def verify_backup(path: Path, counts: dict, strict: bool, rep: Report) -> dict:
    """Open the backup read-only/immutable (no side files) and compare it to the
    source. `strict` (locked source): any difference is fatal; otherwise (live
    source, rehearsal) a count change during the copy is only a warning."""
    first = sha256_file(path)
    backup = open_db(path, "ro", immutable=True)
    try:
        backup_counts = table_counts(backup)
        app_rows = backup_counts.get("app_settings")
    finally:
        backup.close()
    if sha256_file(path) != first:
        raise Abort(EXIT_ERROR, "backup file changed while being verified", "backup")
    if strict:
        if backup_counts != counts:
            raise Abort(EXIT_ERROR, "backup row counts differ from the locked database", "backup")
    elif backup_counts != counts:
        rep.warn("row counts changed while the live database was copied (app is running)")
    return {
        "sha256": first, "bytes": path.stat().st_size, "table_counts": backup_counts,
        "app_settings_rows": app_rows,
    }


# ----------------------------------------------------------------- commands

def classify_commit_error(db: Path) -> str:
    """After a failed COMMIT: look at the real state with a read-only handle."""
    try:
        reader = open_db(db, "ro")
        try:
            state = read_state(reader)
        finally:
            reader.close()
    except Exception:
        return "unknown"
    return "committed" if state["has_row1"] and state["intruders"] == 0 and state["start_valid"] else "not_committed"


def post_commit_verify(db: Path, before_counts: dict) -> list[str]:
    reader = open_db(db, "ro")
    try:
        failed = []
        if messages(reader) != ["ok"]:
            failed.append("integrity_check")
        count, low, high = reader.execute("SELECT count(*), min(id), max(id) FROM app_settings").fetchone()
        if (count, low, high) != (1, 1, 1):
            failed.append("app_settings_single_row")
        if table_counts(reader) != before_counts:
            failed.append("table_counts")
        state = reader.execute(
            "SELECT quiet_hours_start, quiet_hours_end FROM app_settings WHERE id = 1").fetchone()
        if not all(is_valid_time(v) for v in state):
            failed.append("quiet_hours_format")
        return failed
    finally:
        reader.close()


def run_transaction(conn: sqlite3.Connection, db: Path, pins: list[dict], rep: Report) -> dict:
    """BEGIN IMMEDIATE .. COMMIT with every check in between. A failure before
    COMMIT rolls back (exit 3/4); the COMMIT outcome is classified by state."""
    try:
        conn.execute("BEGIN IMMEDIATE")
        rep.in_transaction = True
        problems = check_preconditions(conn, pins)
        if problems:
            raise Abort(EXIT_PRECONDITION, "precondition changed inside the transaction: " + "; ".join(problems), "pre-commit-precondition")
        before = capture(conn)
        info = repair(conn, pins)
        failed = verify_before_commit(conn, before)
        rep.data["checks_failed"] = failed
        if failed:
            raise Abort(EXIT_ROLLED_BACK, "pre-commit verification failed: " + ", ".join(failed), "verification")
        rep.data["freelist"] = {"before": before["freelist"], "after": pragma_int(conn, "freelist_count")}
        rep.data["page_count"] = {"before": before["page_count"], "after": pragma_int(conn, "page_count")}
    except BaseException as exc:
        try:
            conn.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        rep.in_transaction = False
        if isinstance(exc, Abort):
            raise
        raise Abort(EXIT_ROLLED_BACK, f"rolled back after {type(exc).__name__}", "exception") from exc
    try:
        conn.execute("COMMIT")
    except BaseException as exc:
        # Close first: our exclusive lock would hide the real state from a reader.
        try:
            conn.close()
        except sqlite3.Error:
            pass
        state = "unknown" if isinstance(exc, KeyboardInterrupt) else classify_commit_error(db)
        if state == "committed":
            rep.warn("COMMIT raised an error but the database shows the repaired state")
        else:
            rep.in_transaction = False
            if state == "not_committed":
                raise Abort(EXIT_ROLLED_BACK, f"COMMIT failed ({type(exc).__name__}); database unchanged", "commit") from exc
            raise Abort(EXIT_POST_COMMIT, "COMMIT failed and the state is unknown: read the database before doing anything", "commit") from exc
    rep.committed = True
    rep.in_transaction = False
    return {**info, "table_counts": {n: v[0] for n, v in before["tables"].items()}}


def command_repair(args, rep: Report, ports: tuple[int, ...], private_acl) -> int:
    db = Path(args.db)
    pins = load_pins(args.pins)
    base = Path(args.backup_dir)
    rep.data.update({"mode": "apply" if args.apply else "rehearsal",
                     "started": datetime.now().isoformat(timespec="seconds")})
    if args.apply:
        busy = open_ports(ports)
        if busy:
            raise Abort(EXIT_LOCKED, f"ports {busy} are open: stop the app first", "ports-open")
        conn = acquire_exclusive(db)
        rep.data["lock_acquired"] = True
    else:
        conn = open_db(db, "ro")
    try:
        try:
            state = read_state(conn)
        except sqlite3.DatabaseError as exc:
            raise Abort(EXIT_PRECONDITION, f"cannot read app_settings: {exc}", "state") from exc
        if not state["has_row1"]:
            raise Abort(EXIT_PRECONDITION, "app_settings row 1 is missing", "state")
        if state["intruders"] == 0 and state["start_valid"]:
            rep.data["outcome"] = "already_clean"
            say("app_settings is already clean; nothing to do (no backup made)")
            return EXIT_OK
        run_dir = make_run_dir(base, private_acl, rep)
        counts = table_counts(conn)
        backup_path = run_dir / (BACKUP_NAME if args.apply else SNAPSHOT_NAME)
        try:
            backup_to(conn, backup_path)
            rep.data["backup"] = verify_backup(backup_path, counts, args.apply, rep)
            write_sha_file(backup_path, rep.data["backup"]["sha256"])
            if args.apply:
                say("note: the backup contains the agent credentials in clear text; keep it private")
            check = open_db(backup_path, "ro", immutable=True)
            try:
                problems = check_preconditions(check, pins)
                if problems:
                    raise Abort(EXIT_PRECONDITION, "precondition failed" + (" (backup kept)" if args.apply else "") + ": " + "; ".join(problems), "precondition")
                rep.data["pins_verified"] = True
                rep.data["ca03"] = compare_with_agents(check, pins)
            finally:
                check.close()
            rehearse(backup_path, run_dir, pins, rep, messages(conn) if args.apply else None)
        finally:
            if not args.apply:
                discard_snapshot(backup_path, rep)
        if not args.apply:
            rep.data["outcome"] = "rehearsed"
            say("rehearsal ok; nothing was written to the database")
            return EXIT_OK
        rep.data["repair"] = run_transaction(conn, db, pins, rep)
    finally:
        try:
            conn.close()
        except sqlite3.Error as exc:
            rep.warn(f"close failed: {type(exc).__name__}")
    # committed: from here on a failure is never reported as exit 1
    counts_before = rep.data["repair"].pop("table_counts")
    try:
        failed = post_commit_verify(db, {**counts_before, "app_settings": 1})
    except Exception as exc:
        failed = [f"verification error {type(exc).__name__}"]
    rep.data["post_commit_failed"] = failed
    if failed:
        rep.data["outcome"] = "applied_unverified"
        raise Abort(EXIT_POST_COMMIT, "committed, but the check afterwards failed: " + ", ".join(failed) + "; read the database again (read-only) before any rollback", "post-commit")
    rep.data["outcome"] = "applied"
    say("applied: integrity ok, app_settings has 1 row")
    return EXIT_OK


def other_tables_differ(a: sqlite3.Connection, b: sqlite3.Connection) -> list[str]:
    left, right = snapshot_tables(a, skip=("app_settings",)), snapshot_tables(b, skip=("app_settings",))
    return [n for n in sorted(set(left) | set(right)) if left.get(n) != right.get(n)]


def command_rollback(args, rep: Report, ports: tuple[int, ...], private_acl) -> int:
    db = Path(args.db)
    backup = Path(args.rollback)
    rep.data.update({"mode": "rollback", "started": datetime.now().isoformat(timespec="seconds")})
    if not backup.is_absolute() or not backup.is_file():
        raise Abort(EXIT_ERROR, "--rollback must be an absolute path to an existing backup", "rollback-arg")
    sha_file = Path(str(backup) + ".sha256")
    try:
        expected = sha_file.read_text(encoding="ascii").split()[0].lower()
    except (OSError, IndexError) as exc:
        raise Abort(EXIT_PRECONDITION, "backup has no readable .sha256 file", "sha256") from exc
    if sha256_file(backup) != expected:
        raise Abort(EXIT_PRECONDITION, "backup does not match its .sha256: refusing", "sha256")
    busy = open_ports(ports)
    if busy:
        raise Abort(EXIT_LOCKED, f"ports {busy} are open: stop the app first", "ports-open")
    conn = acquire_exclusive(db)
    rep.data["lock_acquired"] = True
    try:
        source = open_db(backup, "ro", immutable=True)
        try:
            differing = other_tables_differ(conn, source)
            if differing:
                raise Abort(EXIT_PRECONDITION, "refusing: tables changed since the backup (restoring would erase "
                            "what the app wrote): " + ", ".join(differing), "tables-changed")
            run_dir = make_run_dir(Path(args.backup_dir), private_acl, rep)
            current = run_dir / PRE_ROLLBACK_NAME
            backup_to(conn, current)
            write_sha_file(current, sha256_file(current))
            rep.data["pre_rollback_backup"] = str(current)
            expected_counts = table_counts(source)
            expected_messages = sorted(messages(source))
            try:
                source.backup(conn)
            except BaseException as exc:
                raise Abort(EXIT_ROLLED_BACK, f"restore did not complete ({type(exc).__name__}); the restore is atomic, database unchanged", "restore") from exc
        finally:
            source.close()
    finally:
        conn.close()
    # like for like: read-only handles on both sides (a read-write one lists more messages)
    try:
        reader = open_db(db, "ro")
        try:
            restored = table_counts(reader) == expected_counts and sorted(messages(reader)) == expected_messages
        finally:
            reader.close()
    except Exception:
        restored = False
    if not restored:
        raise Abort(EXIT_POST_COMMIT, "restored, but the check afterwards failed: read the database (read-only)", "post-restore")
    rep.data["outcome"] = "rolled_back"
    say("rolled back: app_settings and all tables now match the backup (writes made by the app after the repair are gone)")
    return EXIT_OK


# --------------------------------------------------------------------- main

def build_parser() -> argparse.ArgumentParser:
    parser = _Parser(description="Repair app_settings in sessions.db (see module docstring).")
    parser.add_argument("--db", required=True, help="absolute path of sessions.db")
    parser.add_argument("--pins", help="pins file (outside the repository)")
    parser.add_argument("--apply", action="store_true", help="write for real (app must be stopped)")
    parser.add_argument("--rollback", metavar="BACKUP", help="restore from a backup made by this script (needs --apply)")
    parser.add_argument("--backup-dir", help="default: %%LOCALAPPDATA%%\\TaskNexus\\db-backups")
    return parser


def validate_args(parser: argparse.ArgumentParser, args) -> None:
    if not os.path.isabs(args.db):
        parser.error("--db must be an absolute path")
    if not os.path.isfile(args.db) or os.path.getsize(args.db) == 0:
        parser.error("--db must be an existing, non-empty file (it is never created)")
    if args.rollback and not args.apply:
        parser.error("--rollback needs --apply")
    if not args.rollback and not args.pins:
        parser.error("--pins is required")
    if not args.backup_dir:
        local = os.environ.get("LOCALAPPDATA")
        if not local:
            parser.error("--backup-dir is required when LOCALAPPDATA is not set")
        args.backup_dir = os.path.join(local, "TaskNexus", "db-backups")
    if not os.path.isabs(args.backup_dir):
        parser.error("--backup-dir must be an absolute path")


def main(argv: list[str] | None = None, *, ports: tuple[int, ...] = PROBE_PORTS, private_acl=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="backslashreplace")
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
        validate_args(parser, args)
    except SystemExit as exc:
        return exc.code if isinstance(exc.code, int) else EXIT_ERROR
    rep = Report()
    try:
        command = command_rollback if args.rollback else command_repair
        code = command(args, rep, ports, private_acl or apply_private_acl)
    except Abort as abort:
        rep.data["outcome"] = rep.data["outcome"] if rep.data["outcome"] == "applied_unverified" else f"aborted:{abort.reason}"
        say(f"stopped: {abort}")
        code = abort.code
    except BaseException as exc:  # safety net: never exit 1 once committed
        rep.data["outcome"] = f"aborted:{type(exc).__name__}"
        say(f"stopped: unexpected {type(exc).__name__}")
        code = EXIT_POST_COMMIT if rep.committed else EXIT_ROLLED_BACK if rep.in_transaction else EXIT_ERROR
    rep.finish(code)
    return code


if __name__ == "__main__":
    sys.exit(main())
