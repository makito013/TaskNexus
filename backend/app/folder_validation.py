"""Validation of folders typed by the user as project folders (V3, trilha 1).

Why this exists: the PRIMARY folder of a project becomes the agent's cwd and
the root served by the viewer/artifact HTTP routes, on an API without
authentication that the tailnet can reach. A folder like `C:\\` would expose the
whole disk. The goal is to stop accidents and gross exposure, not a hostile
peer (who can already change `projects_root_path`); see section 6 of the plan.

Order is part of the contract:
1. lexical checks, BEFORE touching the disk (a UNC path handed to `realpath`
   opens an outbound SMB connection and leaks the NTLM hash);
2. `path = normpath(abspath(raw))`, `canonical = normcase(realpath(path))`;
3. denylist over BOTH the lexical path and the canonical one (so a junction or
   symlink to a denied folder is caught);
4. existence.

Only the first problem of a path is reported. Pure apart from `os.path`.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from typing import Mapping

MAX_FOLDERS_PER_PROJECT = 10
MAX_NAME_LENGTH = 80
MAX_PATH_LENGTH = 1024

MESSAGES: dict[str, str] = {
    "empty": "Informe um caminho.",
    "not_a_string": "Caminho inválido.",
    "nul_char": "Caminho inválido (caractere proibido).",
    "too_long": f"Caminho muito longo (máximo {MAX_PATH_LENGTH} caracteres).",
    "not_absolute": "Use um caminho absoluto, como D:\\projetos\\meu-app.",
    "unc_or_device": (
        "Caminhos de rede (\\\\servidor) e de dispositivo (\\\\?\\) não são aceitos. "
        "Use uma pasta local."
    ),
    "drive_root": "Esta é a raiz de um disco. Escolha a pasta de um projeto.",
    "projects_root_or_ancestor": "Esta pasta contém todos os seus projetos. Escolha uma subpasta.",
    "system_folder": "Pasta do sistema não pode ser pasta de projeto.",
    "home_root": "Esta é a sua pasta de usuário inteira. Escolha uma subpasta.",
    "sensitive_folder": "Pasta de chaves ou credenciais. Não pode ser pasta de projeto.",
    "not_found": "A pasta não existe nesta máquina.",
    "not_a_directory": "Este caminho é um arquivo, não uma pasta.",
    "duplicate_in_project": "Esta pasta já está neste projeto.",
    "too_many_folders": f"Um projeto pode ter no máximo {MAX_FOLDERS_PER_PROJECT} pastas.",
    "invalid_name": f"Informe um nome com 1 a {MAX_NAME_LENGTH} caracteres.",
    "no_folders": "Adicione ao menos uma pasta.",
    "multiple_primary": "Marque só uma pasta como principal.",
}

# Folders under the profile that hold keys or credentials.
_SENSITIVE_HOME_DIRS = (".ssh", ".claude", ".codex", ".gemini", ".aws", ".gnupg")
_SENSITIVE_HOME_NAME_PREFIXES = (".claude-",)


def _canon(path: str) -> str:
    return os.path.normcase(os.path.realpath(path))


def is_or_inside(canonical: str, base_canonical: str) -> bool:
    """True when `canonical` is `base_canonical` or a descendant of it."""
    path = os.path.normcase(canonical)
    base = os.path.normcase(base_canonical)
    if path == base:
        return True
    return path.startswith(base.rstrip(os.sep) + os.sep)


@dataclass(frozen=True)
class FolderProblem:
    code: str
    message: str


class FolderValidationError(ValueError):
    def __init__(self, problems: list[FolderProblem]):
        self.problems = problems
        super().__init__("; ".join(p.message for p in problems))


def problem(code: str) -> FolderProblem:
    return FolderProblem(code, MESSAGES[code])


@dataclass(frozen=True)
class ValidatedFolder:
    path: str
    canonical_path: str


@dataclass(frozen=True)
class FolderPolicy:
    projects_root: str                       # canonical
    home: str                                # canonical ~
    system_roots: tuple[str, ...] = ()       # canonical
    profile_roots: tuple[str, ...] = ()      # canonical; the folder or an ancestor is denied
    sensitive_prefixes: tuple[str, ...] = ()  # canonical; the folder or a descendant
    # Canonical STRING prefixes (e.g. "<home>\\.claude-"): the folder, a sibling
    # sharing the prefix, or any descendant of those.
    sensitive_name_prefixes: tuple[str, ...] = ()
    max_length: int = MAX_PATH_LENGTH


def default_policy(projects_root: str, env: Mapping[str, str] | None = None) -> FolderPolicy:
    env = os.environ if env is None else env
    home_var = "USERPROFILE" if sys.platform == "win32" else "HOME"
    home = _canon(env.get(home_var) or os.path.expanduser("~"))

    system: list[str] = []
    for var in ("SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"):
        if env.get(var):
            system.append(_canon(env[var]))
    system.extend(_canon(p) for p in ("/etc", "/usr", "/bin", "/System", "/Library"))

    profile = [home]
    for var in ("APPDATA", "LOCALAPPDATA"):
        if env.get(var):
            profile.append(_canon(env[var]))

    return FolderPolicy(
        projects_root=_canon(projects_root),
        home=home,
        system_roots=tuple(dict.fromkeys(system)),
        profile_roots=tuple(dict.fromkeys(profile)),
        sensitive_prefixes=tuple(_canon(os.path.join(home, d)) for d in _SENSITIVE_HOME_DIRS),
        sensitive_name_prefixes=tuple(
            os.path.normcase(os.path.join(home, p)) for p in _SENSITIVE_HOME_NAME_PREFIXES
        ),
    )


def _raise(code: str) -> None:
    raise FolderValidationError([problem(code)])


def _is_drive_root(path: str) -> bool:
    return os.path.dirname(path) == path


def _denied_code(path: str, policy: FolderPolicy) -> str | None:
    """Denylist verdict for ONE normcased path (lexical or canonical)."""
    if _is_drive_root(path):
        return "drive_root"
    if is_or_inside(policy.projects_root, path):
        return "projects_root_or_ancestor"
    if any(is_or_inside(path, root) for root in policy.system_roots if root):
        return "system_folder"
    # The profile itself AND its ancestors (the users folder, AppData, ...): an
    # ancestor would expose the credential folders that live below it.
    if any(is_or_inside(base, path) for base in (policy.home, *policy.profile_roots) if base):
        return "home_root"
    if any(
        is_or_inside(path, prefix) or is_or_inside(prefix, path)
        for prefix in policy.sensitive_prefixes
    ):
        return "sensitive_folder"
    if any(path.startswith(prefix) for prefix in policy.sensitive_name_prefixes):
        return "sensitive_folder"
    return None


def validate_folder_path(raw: object, policy: FolderPolicy) -> ValidatedFolder:
    """Validate a user-typed folder. Raises FolderValidationError (one problem)."""
    # 1. Lexical: nothing here may touch the disk.
    if not isinstance(raw, str):
        _raise("not_a_string")
    if raw == "":
        _raise("empty")
    if "\x00" in raw:
        _raise("nul_char")
    if len(raw) > policy.max_length:
        _raise("too_long")
    # Two leading separators in any mix (Windows reads "/\host" as UNC too);
    # this also covers \\?\ and \\.\ device paths.
    if len(raw) >= 2 and raw[0] in "\\/" and raw[1] in "\\/":
        _raise("unc_or_device")
    if not os.path.isabs(raw) or (
        sys.platform == "win32" and not os.path.splitdrive(raw)[0]
    ):
        _raise("not_absolute")

    path = os.path.normpath(os.path.abspath(raw))
    # 2. Real: resolves junctions and symlinks.
    canonical = _canon(path)

    # 3. Denylist over the lexical AND the canonical path.
    for candidate in dict.fromkeys((os.path.normcase(path), canonical)):
        code = _denied_code(candidate, policy)
        if code is not None:
            _raise(code)

    # 4. Existence.
    if not os.path.exists(canonical):
        _raise("not_found")
    if not os.path.isdir(canonical):
        _raise("not_a_directory")
    return ValidatedFolder(path=path, canonical_path=canonical)


def normalize_name(raw: object) -> str:
    """Trimmed project/workspace name, 1..80 characters, else `invalid_name`."""
    name = raw.strip() if isinstance(raw, str) else ""
    if not name or len(name) > MAX_NAME_LENGTH:
        _raise("invalid_name")
    return name
