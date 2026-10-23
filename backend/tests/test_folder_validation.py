"""Unit tests for folder_validation: every negative of section 6 with its code."""
from __future__ import annotations

import os
import subprocess
import sys

import pytest

from app import folder_validation as fv
from app.folder_validation import (
    FolderPolicy,
    FolderValidationError,
    default_policy,
    is_or_inside,
    normalize_name,
    validate_folder_path,
)

WINDOWS = sys.platform == "win32"


def _canon(path) -> str:
    return os.path.normcase(os.path.realpath(str(path)))


@pytest.fixture
def world(tmp_path):
    """Fake machine: projects root, home with credential folders, system dir."""
    root = tmp_path / "root"
    home = tmp_path / "home"
    system = tmp_path / "sys"
    appdata = home / "AppData" / "Roaming"
    for folder in (
        root / "client" / "app",
        home / "projetos" / "x",
        home / ".ssh" / "keys",
        home / ".claude" / "projects",
        home / ".claude-podesubir",
        home / ".claude-podesubir" / "deep",
        home / ".codex",
        home / ".aws",
        system / "System32",
        appdata,
        tmp_path / "outside" / "app",
    ):
        folder.mkdir(parents=True, exist_ok=True)
    policy = FolderPolicy(
        projects_root=_canon(root),
        home=_canon(home),
        system_roots=(_canon(system),),
        profile_roots=(_canon(home), _canon(appdata)),
        sensitive_prefixes=tuple(
            _canon(home / name)
            for name in (".ssh", ".claude", ".codex", ".gemini", ".aws", ".gnupg")
        ),
        sensitive_name_prefixes=(os.path.normcase(str(home / ".claude-")),),
    )
    return {"tmp": tmp_path, "root": root, "home": home, "system": system,
            "appdata": appdata, "policy": policy}


def _code(raw, policy) -> str:
    with pytest.raises(FolderValidationError) as info:
        validate_folder_path(raw, policy)
    assert len(info.value.problems) == 1
    return info.value.problems[0].code


# -- lexical negatives ----------------------------------------------------------


@pytest.mark.parametrize("raw, code", [
    ("", "empty"),
    (None, "not_a_string"),
    (123, "not_a_string"),
    (["C:\\x"], "not_a_string"),
    ("C:\\x\x00y", "nul_char"),
    ("D:\\" + "a" * 2000, "too_long"),
    ("projetos\\x", "not_absolute"),
    ("..\\..\\Windows", "not_absolute"),
    ("./relative/path", "not_absolute"),
    ("\\\\host\\share", "unc_or_device"),
    ("\\\\?\\C:\\x", "unc_or_device"),
    ("\\\\.\\PhysicalDrive0", "unc_or_device"),
    ("//host/x", "unc_or_device"),
    ("/\\host\\x", "unc_or_device"),
])
def test_lexical_negatives_have_stable_codes(world, raw, code):
    assert _code(raw, world["policy"]) == code


def test_lexical_failures_never_call_realpath(world, monkeypatch):
    def boom(*_args, **_kwargs):
        raise AssertionError("realpath must not run for lexically invalid input")

    monkeypatch.setattr(fv.os.path, "realpath", boom)
    for raw in (
        "\\\\host\\share", "\\\\?\\C:\\x", "//host/x", "projetos\\x", "..\\..\\Windows",
        "C:\\x\x00y", "D:\\" + "a" * 2000, "", None,
    ):
        with pytest.raises(FolderValidationError):
            validate_folder_path(raw, world["policy"])


def test_messages_are_the_ones_of_the_ui_contract(world):
    with pytest.raises(FolderValidationError) as info:
        validate_folder_path("\\\\host\\share", world["policy"])
    assert info.value.problems[0].message == (
        "Caminhos de rede (\\\\servidor) e de dispositivo (\\\\?\\) não são aceitos. "
        "Use uma pasta local."
    )
    assert fv.MESSAGES["drive_root"] == "Esta é a raiz de um disco. Escolha a pasta de um projeto."
    assert fv.MESSAGES["not_absolute"] == "Use um caminho absoluto, como D:\\projetos\\meu-app."


# -- denylist ---------------------------------------------------------------------


def test_drive_root_is_refused(world):
    root = os.path.splitdrive(str(world["tmp"]))[0] + os.sep if WINDOWS else "/"
    assert _code(root, world["policy"]) == "drive_root"
    if WINDOWS:
        assert _code(root.replace("\\", "/"), world["policy"]) == "drive_root"


def test_projects_root_and_its_ancestors_are_refused(world):
    assert _code(str(world["root"]), world["policy"]) == "projects_root_or_ancestor"
    assert _code(str(world["tmp"]), world["policy"]) == "projects_root_or_ancestor"


def test_a_subfolder_of_the_projects_root_is_accepted(world):
    result = validate_folder_path(str(world["root"] / "client" / "app"), world["policy"])
    assert result.canonical_path == _canon(world["root"] / "client" / "app")


def test_system_folder_and_descendants_are_refused(world):
    assert _code(str(world["system"]), world["policy"]) == "system_folder"
    assert _code(str(world["system"] / "System32"), world["policy"]) == "system_folder"


def test_home_and_appdata_roots_are_refused_but_their_subfolders_are_not(world):
    assert _code(str(world["home"]), world["policy"]) == "home_root"
    assert _code(str(world["appdata"]), world["policy"]) == "home_root"
    validate_folder_path(str(world["home"] / "projetos" / "x"), world["policy"])


@pytest.mark.parametrize("relative", [
    ".ssh", ".ssh/keys", ".claude", ".claude/projects", ".codex", ".aws",
    ".claude-podesubir", ".claude-podesubir/deep",
])
def test_sensitive_folders_and_descendants_are_refused(world, relative):
    assert _code(str(world["home"] / relative), world["policy"]) == "sensitive_folder"


def test_dotdot_traversal_into_a_denied_folder_is_caught_after_normalization(world):
    raw = os.path.join(str(world["home"]), "projetos", "..", ".ssh")
    assert _code(raw, world["policy"]) == "sensitive_folder"


@pytest.mark.skipif(not WINDOWS, reason="junctions are a Windows feature")
@pytest.mark.parametrize("target_key, code", [
    ("system", "system_folder"),
    ("ssh", "sensitive_folder"),
])
def test_junction_to_a_denied_folder_is_caught_by_the_canonical_path(
    world, tmp_path, target_key, code
):
    target = world["system"] if target_key == "system" else world["home"] / ".ssh"
    link = tmp_path / "innocent-link"
    done = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(link), str(target)],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        pytest.skip(f"cannot create a junction here: {done.stderr or done.stdout}")
    assert _code(str(link), world["policy"]) == code


@pytest.mark.skipif(WINDOWS, reason="symlinks may need privileges on Windows")
def test_symlink_to_a_denied_folder_is_caught_by_the_canonical_path(world, tmp_path):
    link = tmp_path / "innocent-link"
    os.symlink(world["home"] / ".ssh", link)
    assert _code(str(link), world["policy"]) == "sensitive_folder"


# -- existence ---------------------------------------------------------------------


def test_missing_folder_and_file_instead_of_folder(world):
    missing = world["tmp"] / "outside" / "nao-existe"
    assert _code(str(missing), world["policy"]) == "not_found"
    a_file = world["tmp"] / "outside" / "file.txt"
    a_file.write_text("x")
    assert _code(str(a_file), world["policy"]) == "not_a_directory"


# -- positives ---------------------------------------------------------------------


def test_positive_cases_inside_and_outside_the_projects_root(world):
    inside = validate_folder_path(str(world["root"] / "client" / "app"), world["policy"])
    outside = validate_folder_path(str(world["tmp"] / "outside" / "app"), world["policy"])
    under_home = validate_folder_path(str(world["home"] / "projetos" / "x"), world["policy"])
    for result in (inside, outside, under_home):
        assert os.path.isabs(result.path)
        assert result.canonical_path == _canon(result.path)


def test_trailing_separator_and_mixed_separators_are_normalized(world):
    base = world["tmp"] / "outside" / "app"
    plain = validate_folder_path(str(base), world["policy"])
    trailing = validate_folder_path(str(base) + os.sep, world["policy"])
    assert trailing == plain
    if WINDOWS:
        forward = validate_folder_path(str(base).replace("\\", "/"), world["policy"])
        assert forward == plain
        assert "/" not in forward.path


def test_is_or_inside_uses_normcase_and_path_boundaries():
    assert is_or_inside(os.path.join("a", "b"), "a")
    assert is_or_inside("a", "a")
    assert not is_or_inside("ab", "a")  # a sibling sharing the prefix is not inside
    assert not is_or_inside("a", os.path.join("a", "b"))
    if WINDOWS:
        assert is_or_inside("C:\\Users\\Bruno\\X", "c:\\users\\bruno")


# -- default policy -----------------------------------------------------------------


def test_default_policy_collects_system_profile_and_sensitive_folders(tmp_path, monkeypatch):
    home = tmp_path / "home"
    (home / ".claude").mkdir(parents=True)
    env = {
        "SystemRoot": str(tmp_path / "win"),
        "ProgramFiles": str(tmp_path / "pf"),
        "ProgramFiles(x86)": str(tmp_path / "pf86"),
        "ProgramData": str(tmp_path / "pd"),
        "APPDATA": str(home / "ad"),
        "LOCALAPPDATA": str(home / "lad"),
        "USERPROFILE": str(home),
        "HOME": str(home),
    }
    policy = default_policy(str(tmp_path / "root"), env)
    assert policy.projects_root == _canon(tmp_path / "root")
    assert policy.home == _canon(home)
    for name in ("win", "pf", "pf86", "pd"):
        assert _canon(tmp_path / name) in policy.system_roots
    assert _canon(home / "ad") in policy.profile_roots
    assert _canon(home / "lad") in policy.profile_roots
    assert _canon(home / ".ssh") in policy.sensitive_prefixes
    assert _code(str(home / ".claude-x"), policy) == "sensitive_folder"
    assert _code(str(home), policy) == "home_root"
    assert _code(str(tmp_path / "win" / "System32"), policy) == "system_folder"


# -- names ---------------------------------------------------------------------------


def test_normalize_name_trims_and_limits():
    assert normalize_name("  ymci-docs \n") == "ymci-docs"
    assert normalize_name("a" * 80) == "a" * 80
    for bad in ("", "   ", "a" * 81, None, 5):
        with pytest.raises(FolderValidationError) as info:
            normalize_name(bad)
        assert info.value.problems[0].code == "invalid_name"
        assert info.value.problems[0].message == "Informe um nome com 1 a 80 caracteres."


@pytest.mark.skipif(not WINDOWS, reason="junctions are a Windows feature")
def test_junction_named_like_a_sensitive_folder_is_refused_by_the_lexical_path(world):
    # Only the lexical half of the denylist catches this: the canonical target
    # is an allowed folder, but the typed path sits under a denied name
    # (e.g. dotfiles moved to another disk and linked back).
    link = world["home"] / ".gnupg"
    target = world["tmp"] / "outside" / "app"
    done = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(link), str(target)],
        capture_output=True, text=True,
    )
    assert done.returncode == 0, done.stderr or done.stdout
    assert _code(str(link), world["policy"]) == "sensitive_folder"


# -- ancestors of the profile are denied too --------------------------------------------


@pytest.mark.parametrize("target, code", [
    (lambda w: w["home"] / "AppData", "home_root"),    # ancestor of a profile root
    (lambda w: w["home"], "home_root"),                # the home itself
    (lambda w: w["home"] / ".ssh", "sensitive_folder"),
])
def test_the_profile_its_ancestors_and_sensitive_folders_are_refused(world, target, code):
    assert _code(str(target(world)), world["policy"]) == code


def test_an_ancestor_of_a_sensitive_prefix_is_refused():
    # Fabricated policy where the sensitive folder is NOT below a profile root,
    # so only the sensitive-ancestor rule can refuse its parent.
    root = os.path.normcase(os.path.realpath(os.path.abspath("sandbox-root")))
    base = os.path.normcase(os.path.realpath(os.path.abspath("elsewhere")))
    policy = FolderPolicy(
        projects_root=root, home=os.path.join(base, "h"),
        sensitive_prefixes=(os.path.join(base, "vault", "keys"),),
    )
    assert _code(os.path.join(base, "vault"), policy) == "sensitive_folder"


@pytest.mark.parametrize("sub", [
    ("home", "projetos", "x"),
    ("home", "AppData", "Roaming", "tool"),
    ("home", "Desktop"),
])
def test_ordinary_profile_subfolders_stay_allowed(world, sub):
    folder = world["tmp"].joinpath(*sub)
    folder.mkdir(parents=True, exist_ok=True)
    assert validate_folder_path(str(folder), world["policy"]).canonical_path == _canon(folder)


def test_ancestors_of_the_home_are_refused(tmp_path):
    # The projects root lives elsewhere, so only the home rule can refuse these.
    home = tmp_path / "users" / "me"
    home.mkdir(parents=True)
    other = tmp_path / "work"
    other.mkdir()
    policy = FolderPolicy(projects_root=_canon(other), home=_canon(home),
                          profile_roots=(_canon(home),))
    assert _code(str(home.parent), policy) == "home_root"


def test_ancestors_of_a_profile_root_are_refused(tmp_path):
    home = tmp_path / "users" / "me"
    appdata_local = home / "AppData" / "Local"
    appdata_local.mkdir(parents=True)
    other = tmp_path / "work"
    other.mkdir()
    policy = FolderPolicy(projects_root=_canon(other), home=_canon(home),
                          profile_roots=(_canon(appdata_local),))
    assert _code(str(home / "AppData"), policy) == "home_root"
