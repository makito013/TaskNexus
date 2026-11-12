"""The command catalog of a chat: what the composer may offer after a `/`.

One list per conversation, the union of four sources (keys are names without the slash):

- the disk (read only, never written): `.claude/commands/**/*.md` and `.claude/skills/*/SKILL.md`
  of the project folders (`project`), of `~/.claude` (`user`) and of the installed plugins
  (`plugin`, named `<plugin>:<name>`);
- the live process: `slash_commands` (strings) and `get_server_info()["commands"]`
  (`{name, description, argumentHint}`), for names only it knows (`session`);
- the registry `chat_commands` (`builtin`), editable: its `handling` and `enabled` always win.

Metadata (description, hint) comes from the disk first, then the live process, then the registry.
Files are untrusted text: at most `MAX_FILE_BYTES` read, YAML without aliases, a broken file is
an item with an empty description, never an exception.

Without a live process the list is the disk plus the registry (the screen lists it; sending
resumes the process).
"""
from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from pathlib import Path

import yaml

from .engine import is_valid_model
from .errors import ChatCommandError
from .runtime import InitInfo
from .store import ChatStore

COMMAND_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9:_-]{0,63}$")
HANDLINGS = ("dispatch", "ui", "hidden")
MAX_ITEMS = 200
MAX_FILE_BYTES = 64 * 1024
MAX_FILES_PER_ROOT = 500
MAX_DESCRIPTION = 500
MAX_ARGUMENT_HINT = 200
# Commands that only make sense in the terminal: never `dispatch`, whatever the registry says.
TERMINAL_ONLY = frozenset({"login", "logout", "theme", "terminal-setup", "permissions", "resume"})

_FRONTMATTER_RE = re.compile(r"\A---[ \t]*\r?\n(.*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|\Z)", re.DOTALL)
_SKILL_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$")
_FIRST_TOKEN_RE = re.compile(r"^/([^\s/][^\s]*)")


def command_name(text: str) -> str:
    """The command a message starts with (`/Model sonnet` -> `model`), else an empty string."""
    match = _FIRST_TOKEN_RE.match(text)
    return match.group(1).lower() if match else ""


# -- validation of what the client sends ---------------------------------------------------------


def _bounded_text(value: object, limit: int, what: str, code: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > limit:
        raise ChatCommandError(code, f"{what} must be text of at most {limit} characters")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:  # a lone surrogate: SQLite could not bind it
        raise ChatCommandError(code, f"{what} must be valid text") from None
    return value


def _flags(item: dict, code: str) -> tuple[bool, int]:
    enabled = item.get("enabled", True)
    sort = item.get("sort", 0)
    if not isinstance(enabled, bool):
        raise ChatCommandError(code, "enabled must be true or false")
    if isinstance(sort, bool) or not isinstance(sort, int) or abs(sort) > 1_000_000:
        raise ChatCommandError(code, "sort must be a whole number")
    return enabled, sort


def _checked_list(raw: object, code: str, what: str) -> list[dict]:
    if not isinstance(raw, list) or len(raw) > MAX_ITEMS:
        raise ChatCommandError(code, f"{what} must be a list of at most {MAX_ITEMS} entries")
    if not all(isinstance(item, dict) for item in raw):
        raise ChatCommandError(code, f"every entry of {what} must be an object")
    return raw


def validate_command_items(raw: object) -> list[dict]:
    """Entries of `PUT /api/chat/commands`, normalised; `invalid_command` for anything else."""
    code = "invalid_command"
    items, seen = [], set()
    for item in _checked_list(raw, code, "commands"):
        name = item.get("name")
        if not isinstance(name, str) or not COMMAND_NAME_RE.fullmatch(name) or name in seen:
            raise ChatCommandError(code, "name must be unique, lower case letters, digits, ':', '_' or '-'")
        if item.get("handling") not in HANDLINGS:
            raise ChatCommandError(code, "handling must be dispatch, ui or hidden")
        enabled, sort = _flags(item, code)
        seen.add(name)
        items.append({
            "name": name, "handling": item["handling"], "enabled": enabled, "sort": sort,
            "description": _bounded_text(item.get("description"), MAX_DESCRIPTION, "description", code),
            "argument_hint": _bounded_text(item.get("argument_hint"), MAX_ARGUMENT_HINT, "argument_hint", code),
        })
    return items


def validate_model_items(raw: object) -> list[dict]:
    """Entries of `PUT /api/chat/models`, normalised; `invalid_model` for anything else."""
    code = "invalid_model"
    items, seen = [], set()
    for item in _checked_list(raw, code, "models"):
        value = item.get("value")
        if not is_valid_model(value) or value in seen:
            raise ChatCommandError(code, "value must be a unique model alias or id")
        display_name = _bounded_text(item.get("display_name", value), 100, "display_name", code)
        if not display_name or not display_name.strip():
            raise ChatCommandError(code, "display_name must not be empty")
        enabled, sort = _flags(item, code)
        seen.add(value)
        items.append({
            "value": value, "display_name": display_name, "enabled": enabled, "sort": sort,
            "description": _bounded_text(item.get("description"), MAX_DESCRIPTION, "description", code),
        })
    return items


# -- the disk ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class DiskCommand:
    name: str
    description: str
    argument_hint: str
    source: str  # project | user | plugin
    user_invocable: bool
    disable_model_invocation: bool


def _front_matter(path: Path) -> dict:
    """The YAML header of a file, or `{}` for anything unreadable, oversized, broken or using
    aliases (they can blow a small document up)."""
    try:
        with open(path, "rb") as handle:
            text = handle.read(MAX_FILE_BYTES).decode("utf-8", errors="replace")
        match = _FRONTMATTER_RE.match(text)
        if match is None:
            return {}
        if any(isinstance(event, yaml.AliasEvent) for event in yaml.parse(match.group(1), Loader=yaml.SafeLoader)):
            return {}
        data = yaml.safe_load(match.group(1))
    except (OSError, yaml.YAMLError, ValueError, RecursionError):
        return {}
    return data if isinstance(data, dict) else {}


def _text(value: object, limit: int) -> str:
    if isinstance(value, list):  # `argument-hint: [issue]` is a YAML list
        value = "[" + " ".join(str(part) for part in value) + "]"
    return " ".join(value.split())[:limit] if isinstance(value, str) else ""


def _disk_command(name: str, front: dict, source: str) -> DiskCommand:
    return DiskCommand(
        name=name,
        description=_text(front.get("description"), MAX_DESCRIPTION),
        argument_hint=_text(front.get("argument-hint"), MAX_ARGUMENT_HINT),
        source=source,
        user_invocable=front.get("user-invocable") is not False,
        disable_model_invocation=front.get("disable-model-invocation") is True,
    )


def _files(root: Path, pattern: str) -> list[Path]:
    """Regular files under `root` that match, never through a link, bounded."""
    if not root.is_dir() or root.is_symlink():
        return []
    found = []
    for path in sorted(root.glob(pattern)):
        if path.is_file() and not path.is_symlink():
            found.append(path)
            if len(found) >= MAX_FILES_PER_ROOT:
                break
    return found


def _scan_root(base: Path, source: str, prefix: str = "") -> list[DiskCommand]:
    """`base` holds `commands/` and `skills/` (a `.claude` folder or an installed plugin)."""
    found = []
    for path in _files(base / "commands", "**/*.md"):
        name = ":".join(path.relative_to(base / "commands").with_suffix("").parts)
        found.append(_disk_command(prefix + name, _front_matter(path), source))
    for path in _files(base / "skills", "*/SKILL.md"):
        front = _front_matter(path)
        declared = front.get("name")
        name = declared if isinstance(declared, str) and _SKILL_NAME_RE.fullmatch(declared) else path.parent.name
        found.append(_disk_command(prefix + name, front, source))
    return found


def _registry_roots(registry: Path, enabled: dict) -> list[tuple[str, Path]] | None:
    """The installs of `installed_plugins.json` minus the plugins `enabledPlugins` turned off, or
    None when either file cannot be read."""
    try:
        data = json.loads(registry.read_text(encoding="utf-8"))
        roots = []
        for key, installs in (data.get("plugins") or {}).items():
            if enabled.get(key) is False:
                continue
            for install in installs or []:
                roots.append((str(key).split("@")[0], Path(install["installPath"])))
        return roots
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


def _enabled_plugins(home: Path) -> dict | None:
    """`enabledPlugins` of `~/.claude/settings.json` (`{"<name>@<marketplace>": bool}`), or None."""
    try:
        data = json.loads((home / ".claude" / "settings.json").read_text(encoding="utf-8"))
        enabled = data.get("enabledPlugins")
    except (OSError, ValueError, AttributeError):
        return None
    return enabled if isinstance(enabled, dict) else None


def _plugin_roots(home: Path) -> list[tuple[str, Path]]:
    """`(plugin name, install folder)` of the enabled plugins: the installs of
    `installed_plugins.json` (`{"plugins": {"<name>@<marketplace>": [{"installPath": ...}]}}`)
    minus the ones `enabledPlugins` of `settings.json` turned off. When either file is missing or
    unreadable, the folders of `plugins/cache/<marketplace>/<plugin>/<version>` that were not
    orphaned. Only folders inside `~/.claude/plugins` count. Read only; never raises."""
    plugins = home / ".claude" / "plugins"
    enabled = _enabled_plugins(home)
    roots = _registry_roots(plugins / "installed_plugins.json", enabled) if enabled is not None else None
    if roots is None:
        roots = []
        try:
            for version in sorted((plugins / "cache").glob("*/*/*")):
                if version.is_dir() and not (version / ".orphaned_at").exists():
                    roots.append((version.parent.name, version))
        except OSError:
            roots = []
    try:
        inside = plugins.resolve()
        return [(name, root) for name, root in roots if root.resolve().is_relative_to(inside)]
    except OSError:
        return []


# -- the catalog ---------------------------------------------------------------------------------


class CommandCatalog:
    def __init__(self, store: ChatStore, home: Path):
        self.store = store
        self.home = home
        # (session key, has a live process) -> list; dropped by `invalidate`.
        self._cache: dict[tuple[str, bool], list[dict]] = {}

    def invalidate(self, session_key: str | None = None) -> None:
        """Forget one conversation's list (a new `init`) or all of them (the registry changed)."""
        if session_key is None:
            self._cache.clear()
        else:
            self._cache.pop((session_key, True), None)
            self._cache.pop((session_key, False), None)

    async def for_session(
        self, session_key: str, cwd: str, add_dirs: list[str], live: InitInfo | None
    ) -> list[dict]:
        cache_key = (session_key, live is not None)
        cached = self._cache.get(cache_key)
        if cached is None:
            disk = await asyncio.to_thread(self._scan, [cwd, *add_dirs])
            registry = {row["name"]: row for row in await self.store.list_commands()}
            cached = self._cache[cache_key] = self._merge(disk, registry, live)
        return [dict(item) for item in cached]

    def _scan(self, folders: list[str]) -> list[DiskCommand]:
        found = []
        for folder in folders:
            if folder:
                found += _scan_root(Path(folder) / ".claude", "project")
        found += _scan_root(self.home / ".claude", "user")
        for plugin, root in _plugin_roots(self.home):
            found += _scan_root(root, "plugin", prefix=f"{plugin}:")
        return found

    @staticmethod
    def _merge(disk: list[DiskCommand], registry: dict[str, dict], live: InitInfo | None) -> list[dict]:
        on_disk: dict[str, DiskCommand] = {}
        for command in disk:
            on_disk.setdefault(command.name, command)  # the first folder to define a name wins
        session: dict[str, dict] = {}
        if live is not None:
            for name in live.slash_commands:
                session.setdefault(name.lstrip("/"), {})
            for entry in live.commands:
                name = entry.get("name")
                if isinstance(name, str) and name.strip("/"):
                    session[name.lstrip("/")] = entry

        items = []
        for name in [*registry, *sorted((on_disk.keys() | session.keys()) - registry.keys())]:
            disk_item, live_item, row = on_disk.get(name), session.get(name, {}), registry.get(name)
            handling = row["handling"] if row else ("dispatch" if disk_item is None or disk_item.user_invocable else "hidden")
            if name in TERMINAL_ONLY and handling == "dispatch":
                handling = "hidden"
            if handling == "hidden" or (row is not None and not row["enabled"]):
                continue
            items.append({
                "name": name,
                "description": (disk_item.description if disk_item else "")
                or _text(live_item.get("description"), MAX_DESCRIPTION) or _text(row and row["description"], MAX_DESCRIPTION),
                "argument_hint": (disk_item.argument_hint if disk_item else "")
                or _text(live_item.get("argumentHint"), MAX_ARGUMENT_HINT) or _text(row and row["argument_hint"], MAX_ARGUMENT_HINT),
                "source": disk_item.source if disk_item else ("builtin" if row else "session"),
                "handling": handling,
                "disable_model_invocation": bool(disk_item and disk_item.disable_model_invocation),
            })
        return items
