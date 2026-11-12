"""chat/availability.py: the `claude` binary resolver, the SDK probe and the boot warning."""
from __future__ import annotations

import os
import subprocess
import sys
from types import SimpleNamespace

import pytest

from app.chat import availability
from app.chat.availability import CliResolver, sdk_status, warn_if_session_env_inherited


def _binary(tmp_path, name: str = "claude.exe", folder: str = "bin"):
    path = tmp_path / folder / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("stub", encoding="utf-8")
    return path


class _Version:
    """run_version stub that counts calls."""

    def __init__(self, text: str = "2.1.317 (Claude Code)"):
        self.text = text
        self.calls: list[str] = []

    def __call__(self, path: str) -> str:
        self.calls.append(path)
        return self.text


def _resolver(*, env=None, which=None, run_version=None, min_version="2.1.317", clock=None):
    kwargs = {}
    if clock is not None:
        kwargs["clock"] = clock
    return CliResolver(
        min_version=min_version,
        env=env or {},
        which=which or (lambda name: None),
        run_version=run_version or _Version(),
        **kwargs,
    )


def test_precedence_env_path_over_agent_cmd_over_which(tmp_path):
    from_env = _binary(tmp_path, "claude.exe", "env")
    from_cmd = _binary(tmp_path, "claude.exe", "cmd")
    from_which = _binary(tmp_path, "claude.exe", "which")
    which = lambda name: str(from_which)  # noqa: E731
    agent = SimpleNamespace(cmd=[str(from_cmd)])

    assert _resolver(env={"CHAT_CLI_PATH": str(from_env)}, which=which).resolve(agent).path == str(from_env)
    assert _resolver(which=which).resolve(agent).path == str(from_cmd)
    assert _resolver(which=which).resolve(SimpleNamespace(cmd=[])).path == str(from_which)
    assert _resolver(which=which).resolve(None).path == str(from_which)


def test_a_bare_command_name_goes_through_which(tmp_path):
    found = _binary(tmp_path)
    seen = []

    def which(name):
        seen.append(name)
        return str(found)

    info = _resolver(which=which).resolve(SimpleNamespace(cmd=["claude"]))

    assert seen == ["claude"] and info.ok and info.path == str(found)


def test_missing_binary_is_cli_not_found(tmp_path):
    for env, agent in (
        ({}, SimpleNamespace(cmd=["claude"])),
        ({"CHAT_CLI_PATH": str(tmp_path / "gone.exe")}, None),
    ):
        info = _resolver(env=env).resolve(agent)
        assert (info.ok, info.reason, info.path) == (False, "cli_not_found", None)


@pytest.mark.parametrize("name", ["claude.cmd", "claude.bat", "claude.ps1", "CLAUDE.CMD", "Claude.BAT", "x.Ps1"])
def test_script_wrappers_are_refused_in_any_case(tmp_path, name):
    run = _Version()

    info = _resolver(env={"CHAT_CLI_PATH": str(_binary(tmp_path, name))}, run_version=run).resolve()

    assert (info.ok, info.reason) == (False, "cli_invalid")
    assert run.calls == []  # never executed


def test_uppercase_exe_extension_is_accepted(tmp_path):
    info = _resolver(env={"CHAT_CLI_PATH": str(_binary(tmp_path, "claude.EXE"))}).resolve()

    assert info.ok and info.version == "2.1.317"


def test_the_binary_bundled_in_the_sdk_package_is_refused(tmp_path):
    bundled = _binary(tmp_path, "claude.exe", "site-packages/claude_agent_sdk/_bundled")
    run = _Version()

    info = _resolver(env={"CHAT_CLI_PATH": str(bundled)}, run_version=run).resolve()

    assert (info.ok, info.reason) == (False, "cli_invalid")
    assert run.calls == []


def test_the_bundled_binary_is_refused_even_through_a_non_normalised_path(tmp_path):
    bundled = _binary(tmp_path, "claude.exe", "site-packages/claude_agent_sdk/_bundled")
    sep = os.sep
    sneaky_marker = f"claude_agent_sdk{sep}.{sep}_bundled"
    sneaky = str(bundled).replace(f"claude_agent_sdk{sep}_bundled", sneaky_marker)
    assert sneaky_marker in sneaky and os.path.isfile(sneaky)
    run = _Version()

    info = _resolver(env={"CHAT_CLI_PATH": sneaky}, run_version=run).resolve()

    assert (info.ok, info.reason) == (False, "cli_invalid")
    assert run.calls == []


def test_non_utf8_output_from_the_binary_is_cli_invalid_not_an_exception(tmp_path, monkeypatch):
    # The binary prints an emoji in UTF-8 plus a stray 0xFF; the console code page
    # (cp1252 on Windows) cannot decode it. The real runner is used, with the child
    # swapped for a Python one-liner that produces those bytes.
    code = r"import sys; sys.stdout.buffer.write('\u274c boom'.encode() + b'\xff\n')"
    real_popen = subprocess.Popen

    def popen_stand_in(cmd, **kwargs):
        return real_popen([sys.executable, "-c", code], **kwargs)

    monkeypatch.setattr(availability.subprocess, "Popen", popen_stand_in)
    resolver = CliResolver(
        env={"CHAT_CLI_PATH": str(_binary(tmp_path))}, run_version=availability._default_run_version
    )

    # The output is decoded as UTF-8 with replacement, not lost to a dead reader thread.
    assert "boom" in availability._default_run_version("ignored")
    info = resolver.resolve()

    assert (info.ok, info.reason) == (False, "cli_invalid")
    assert "version number" in info.detail


@pytest.mark.parametrize("text,ok", [
    ("2.1.313 (Claude Code)", False),
    ("2.1.316", False),
    ("1.99.999", False),
    ("2.1.317 (Claude Code)", True),
    ("2.1.317\n", True),
    ("2.2.0", True),
    ("3.0.0", True),
])
def test_minimum_version_gate(tmp_path, text, ok):
    info = _resolver(
        env={"CHAT_CLI_PATH": str(_binary(tmp_path))}, run_version=_Version(text)
    ).resolve()

    assert info.ok is ok
    assert info.reason == (None if ok else "cli_version_unsupported")
    assert info.version == text.split()[0]


def test_default_minimum_is_the_version_proven_by_g0():
    assert availability.DEFAULT_MIN_CLI_VERSION == "2.1.317"


def test_a_higher_minimum_raises_the_bar(tmp_path):
    env = {"CHAT_CLI_PATH": str(_binary(tmp_path))}

    assert _resolver(env=env, min_version="2.1.317").resolve().ok
    assert not _resolver(env=env, min_version="2.1.318").resolve().ok


def test_min_version_comes_from_the_environment_it_is_given():
    assert CliResolver(env={"CHAT_MIN_CLI_VERSION": "2.5.0"}).min_version == "2.5.0"
    assert CliResolver(env={"CHAT_MIN_CLI_VERSION": " 2.5.0 "}).min_version == "2.5.0"
    assert CliResolver(env={"CHAT_MIN_CLI_VERSION": "garbage"}).min_version == "2.1.317"
    assert CliResolver(env={}).min_version == "2.1.317"


@pytest.mark.parametrize("configured", ["1.0.0", "2.1.316", "0.0.1"])
def test_the_configured_minimum_cannot_go_below_the_supported_one(tmp_path, configured, caplog):
    env = {"CHAT_CLI_PATH": str(_binary(tmp_path)), "CHAT_MIN_CLI_VERSION": configured}
    resolver = CliResolver(env=env, run_version=_Version("2.1.100"))

    info = resolver.resolve()

    assert resolver.min_version == "2.1.317"
    assert (info.ok, info.reason) == (False, "cli_version_unsupported")
    assert "below the supported minimum" in caplog.text


def test_the_minimum_in_a_dotenv_file_counts_because_it_is_read_when_the_resolver_is_built(
    tmp_path, monkeypatch
):
    from dotenv import load_dotenv

    dotenv = tmp_path / ".env"
    dotenv.write_text("CHAT_MIN_CLI_VERSION=9.0.0\n", encoding="utf-8")
    monkeypatch.setenv("CHAT_MIN_CLI_VERSION", "placeholder")  # restored on teardown
    monkeypatch.delenv("CHAT_MIN_CLI_VERSION")
    resolver_before = CliResolver()  # `availability` was imported long before the .env was read
    load_dotenv(dotenv)
    monkeypatch.setenv("CHAT_CLI_PATH", str(_binary(tmp_path)))

    resolver_after = CliResolver(run_version=_Version("2.1.317"))

    assert resolver_before.min_version == "2.1.317"
    assert resolver_after.min_version == "9.0.0"
    assert resolver_after.resolve().reason == "cli_version_unsupported"


def test_invalid_minimum_is_a_constructor_error():
    with pytest.raises(ValueError):
        CliResolver(min_version="two")


def test_version_is_cached_per_path_and_mtime_for_ten_minutes(tmp_path):
    import os

    binary = _binary(tmp_path)
    run = _Version()
    now = [1000.0]
    resolver = _resolver(env={"CHAT_CLI_PATH": str(binary)}, run_version=run, clock=lambda: now[0])

    resolver.resolve()
    resolver.resolve()
    assert len(run.calls) == 1

    now[0] += availability.CLI_VERSION_CACHE_SECONDS - 1
    resolver.resolve()
    assert len(run.calls) == 1

    now[0] += 2  # expired
    resolver.resolve()
    assert len(run.calls) == 2

    stat = binary.stat()  # a new mtime is a different binary
    os.utime(binary, (stat.st_atime, stat.st_mtime + 5))
    resolver.resolve()
    assert len(run.calls) == 3


def test_timeout_and_os_errors_become_cli_invalid(tmp_path):
    env = {"CHAT_CLI_PATH": str(_binary(tmp_path))}

    def timeout(path):
        raise subprocess.TimeoutExpired(path, 10)

    def broken(path):
        raise OSError("not a valid Win32 application")

    for failing in (timeout, broken):
        info = _resolver(env=env, run_version=failing).resolve()
        assert (info.ok, info.reason) == (False, "cli_invalid")
        assert info.path is not None


def test_failed_probes_are_not_cached(tmp_path):
    env = {"CHAT_CLI_PATH": str(_binary(tmp_path))}
    run = _Version("not a version")
    resolver = _resolver(env=env, run_version=run)

    resolver.resolve()
    run.text = "2.1.317"

    assert resolver.resolve().ok


def test_a_real_non_claude_executable_is_cli_invalid():
    info = CliResolver(env={"CHAT_CLI_PATH": sys.executable}).resolve()

    assert (info.ok, info.reason) == (False, "cli_invalid")
    assert "version" in info.detail


# -- SDK probe ------------------------------------------------------------------------------


@pytest.fixture
def fresh_sdk_status():
    availability.reset_for_tests()
    yield
    availability.reset_for_tests()


def test_sdk_status_reports_a_missing_package(monkeypatch, fresh_sdk_status):
    monkeypatch.setitem(sys.modules, "claude_agent_sdk", None)  # import raises ImportError

    status = sdk_status()

    assert status.available is False and status.version is None
    assert "ImportError" in status.detail or "ModuleNotFoundError" in status.detail


def test_sdk_status_survives_any_exception_not_only_import_error(monkeypatch, fresh_sdk_status):
    def explode(name):
        raise RuntimeError("pydantic is on fire")

    monkeypatch.setattr(availability.importlib, "import_module", explode)

    status = sdk_status()

    assert status.available is False
    assert status.detail == "RuntimeError: pydantic is on fire"


def test_sdk_status_is_tried_once_and_cached(monkeypatch, fresh_sdk_status):
    calls = []

    def fake_import(name):
        calls.append(name)
        return SimpleNamespace(__version__="9.9.9")

    monkeypatch.setattr(availability.importlib, "import_module", fake_import)

    first, second = sdk_status(), sdk_status()

    assert calls == ["claude_agent_sdk"]
    assert first is second
    assert (first.available, first.version, first.detail) == (True, "9.9.9", None)

    availability.reset_for_tests()
    sdk_status()
    assert len(calls) == 2


# -- boot warning ---------------------------------------------------------------------------


def test_boot_warning_names_the_inherited_variables(capsys):
    assert warn_if_session_env_inherited({"CLAUDECODE": "1", "PATH": "x"}) is True
    assert "CLAUDECODE" in capsys.readouterr().out
    assert warn_if_session_env_inherited({"CLAUDE_CODE_CHILD_SESSION": "1"}) is True
    assert "transcripts may be disabled" in capsys.readouterr().out


def test_boot_warning_is_silent_in_a_clean_environment(capsys):
    assert warn_if_session_env_inherited({"PATH": "x", "CLAUDE_EFFORT": "high"}) is False
    assert capsys.readouterr().out == ""


# -- O14 / O10 --------------------------------------------------------------------------------------


@pytest.mark.parametrize("text", ["9" * 5000 + ".0.0", "1234567890.0.0"], ids=["5000-digits", "10-digits"])
def test_a_gigantic_version_number_is_not_a_version_and_never_raises(tmp_path, text):
    resolver = CliResolver(env={"CHAT_CLI_PATH": str(_binary(tmp_path))}, run_version=lambda path: text)

    info = resolver.resolve()

    assert (info.ok, info.reason) == (False, "cli_invalid")


def test_a_long_digit_run_in_the_last_part_does_not_raise_either(tmp_path):
    resolver = CliResolver(
        env={"CHAT_CLI_PATH": str(_binary(tmp_path))}, run_version=lambda path: "2.1." + "7" * 5000
    )

    info = resolver.resolve()  # must return, not raise ValueError

    assert info.version == "2.1." + "7" * 9


def test_a_gigantic_minimum_in_the_environment_is_ignored_with_the_default(tmp_path):
    resolver = CliResolver(env={"CHAT_MIN_CLI_VERSION": "9" * 5000 + ".0.0"})

    assert resolver.min_version == availability.DEFAULT_MIN_CLI_VERSION


def test_a_grandchild_holding_the_output_open_cannot_outlive_the_version_timeout(tmp_path, monkeypatch):
    """The real runner against a child that spawns a grandchild which keeps running and
    inherits the output: the wait must end at the timeout, not when the grandchild ends."""
    import time

    script = tmp_path / "hang.py"
    script.write_text(
        "import subprocess, sys, time\n"
        "subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])\n"
        "time.sleep(30)\n",
        encoding="utf-8",
    )
    real_popen = subprocess.Popen
    monkeypatch.setattr(
        availability.subprocess, "Popen",
        lambda cmd, **kwargs: real_popen([sys.executable, str(script)], **kwargs),
    )
    monkeypatch.setattr(availability, "CLI_VERSION_TIMEOUT_SECONDS", 1)
    resolver = CliResolver(
        env={"CHAT_CLI_PATH": str(_binary(tmp_path))}, run_version=availability._default_run_version
    )

    started = time.monotonic()
    info = resolver.resolve()

    assert time.monotonic() - started < 8
    assert (info.ok, info.reason) == (False, "cli_invalid")
    assert "timed out" in info.detail


# -- O11: the default PATH lookup never picks a binary from the current directory ----------------------------


def test_a_claude_exe_in_the_current_directory_is_not_found_by_the_default_lookup(tmp_path, monkeypatch):
    planted = tmp_path / "claude.exe"
    planted.write_bytes(b"MZ")
    elsewhere = tmp_path / "bin"
    elsewhere.mkdir()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("PATH", str(elsewhere))
    monkeypatch.delenv("NoDefaultCurrentDirectoryInExePath", raising=False)

    assert availability._which_on_path("claude") is None
    info = CliResolver(env={}).resolve()
    assert (info.ok, info.reason) == (False, "cli_not_found")


def test_a_claude_exe_on_path_is_still_found_by_the_default_lookup(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    real = bin_dir / "claude.exe"
    real.write_bytes(b"MZ")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("PATH", str(bin_dir))

    assert os.path.normcase(availability._which_on_path("claude")) == os.path.normcase(str(real))
