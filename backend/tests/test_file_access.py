"""Testes de app/file_access.py (Fase V, Parte 6 seções 6.4.2 e 6.7).

`resolve_safe_path` é a única porta de entrada de caminhos vindos do agente e
da tela para o disco, então cada forma de fuga conhecida tem um teste: `..`,
absoluto fora, symlink para fora, NUL, barra invertida, pasta, inexistente e
cada item da denylist.
"""
from __future__ import annotations

import os
import sys

import pytest

from app.file_access import (
    HEAD_BYTES,
    InvalidPathError,
    OutsideProjectError,
    ProtectedFileError,
    detect_kind,
    is_denied,
    is_text_kind,
    is_within_directory,
    language_for,
    project_dir_from_id,
    resolve_safe_path,
    to_relative_posix,
)

_symlinks = pytest.mark.skipif(
    sys.platform == "win32", reason="criar symlink no Windows exige privilégio"
)


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "projeto"
    (root / "docs").mkdir(parents=True)
    (root / "README.md").write_text("# Olá\n", encoding="utf-8")
    (root / "docs" / "plano.md").write_text("plano", encoding="utf-8")
    return root


# -- resolve_safe_path: caminhos aceitos ---------------------------------------


def test_relative_path_inside_project_is_resolved_to_realpath(project):
    real = resolve_safe_path(str(project), "docs/plano.md")
    assert real == os.path.realpath(str(project / "docs" / "plano.md"))


def test_dot_slash_and_inner_dotdot_that_stay_inside_are_fine(project):
    expected = os.path.realpath(str(project / "README.md"))
    assert resolve_safe_path(str(project), "./README.md") == expected
    assert resolve_safe_path(str(project), "docs/../README.md") == expected


def test_absolute_path_inside_project_is_accepted(project):
    absolute = str(project / "docs" / "plano.md")
    assert resolve_safe_path(str(project), absolute) == os.path.realpath(absolute)


def test_surrounding_whitespace_is_ignored(project):
    # O agente às vezes manda o caminho com quebra de linha no fim.
    assert resolve_safe_path(str(project), "  README.md\n") == os.path.realpath(
        str(project / "README.md")
    )


@_symlinks
def test_symlink_inside_project_pointing_inside_is_accepted(project):
    (project / "atalho.md").symlink_to(project / "docs" / "plano.md")
    real = resolve_safe_path(str(project), "atalho.md")
    assert real == os.path.realpath(str(project / "docs" / "plano.md"))


@_symlinks
def test_project_root_reached_through_a_symlink_works_both_ways(tmp_path, project):
    # macOS: /var -> /private/var. A raiz configurada e o caminho absoluto que
    # o agente manda podem vir por lados diferentes do symlink.
    link_root = tmp_path / "link-para-projeto"
    link_root.symlink_to(project, target_is_directory=True)
    expected = os.path.realpath(str(project / "README.md"))
    assert resolve_safe_path(str(link_root), "README.md") == expected
    assert resolve_safe_path(str(link_root), str(project / "README.md")) == expected
    # O inverso (raiz real, caminho por um atalho QUALQUER que aponta para
    # dentro) é recusado de propósito: aceitar exigiria rodar realpath em
    # caminho arbitrário antes da checagem léxica, que é justamente o que
    # protege o Windows de UNC/SMB.
    with pytest.raises(OutsideProjectError):
        resolve_safe_path(str(project), str(link_root / "README.md"))


# -- resolve_safe_path: recusas ------------------------------------------------


def test_dotdot_escaping_the_project_is_refused(project, tmp_path):
    (tmp_path / "fora.txt").write_text("segredo", encoding="utf-8")
    with pytest.raises(OutsideProjectError) as exc:
        resolve_safe_path(str(project), "../fora.txt")
    assert str(exc.value) == "Caminho fora do projeto"
    # Continua sendo PermissionError (contrato da especificação).
    assert isinstance(exc.value, PermissionError)


def test_absolute_path_outside_is_refused(project, tmp_path):
    outside = tmp_path / "outro" / "a.txt"
    outside.parent.mkdir()
    outside.write_text("x", encoding="utf-8")
    with pytest.raises(OutsideProjectError):
        resolve_safe_path(str(project), str(outside))


def test_sibling_directory_with_common_prefix_is_refused(project, tmp_path):
    # "projeto-2" começa com "projeto": comparação por prefixo de string
    # aceitaria; commonpath não.
    sibling = tmp_path / "projeto-2"
    sibling.mkdir()
    (sibling / "a.txt").write_text("x", encoding="utf-8")
    with pytest.raises(OutsideProjectError):
        resolve_safe_path(str(project), str(sibling / "a.txt"))


def test_nonexistent_path_outside_is_reported_as_outside_not_missing(project):
    # Não confirma nem nega a existência de nada fora do projeto.
    with pytest.raises(OutsideProjectError):
        resolve_safe_path(str(project), "../../nao-existe/em/lugar/nenhum")


@_symlinks
def test_symlink_pointing_outside_the_project_is_refused(project, tmp_path):
    (tmp_path / "segredo.txt").write_text("x", encoding="utf-8")
    (project / "inocente.txt").symlink_to(tmp_path / "segredo.txt")
    with pytest.raises(OutsideProjectError):
        resolve_safe_path(str(project), "inocente.txt")


@_symlinks
def test_symlinked_directory_pointing_outside_is_refused(project, tmp_path):
    (tmp_path / "fora").mkdir()
    (tmp_path / "fora" / "a.md").write_text("x", encoding="utf-8")
    (project / "pasta").symlink_to(tmp_path / "fora", target_is_directory=True)
    with pytest.raises(OutsideProjectError):
        resolve_safe_path(str(project), "pasta/a.md")


def test_null_byte_is_refused(project):
    with pytest.raises(InvalidPathError):
        resolve_safe_path(str(project), "README.md\x00.txt")


@pytest.mark.parametrize("caminho", ["", "   ", None])
def test_empty_path_is_refused(project, caminho):
    with pytest.raises(InvalidPathError) as exc:
        resolve_safe_path(str(project), caminho)
    assert "caminho" in str(exc.value).lower()


@pytest.mark.skipif(sys.platform == "win32", reason="no Windows a barra invertida é separador")
def test_backslash_is_refused_outside_windows(project):
    with pytest.raises(InvalidPathError):
        resolve_safe_path(str(project), "docs\\plano.md")


@pytest.mark.skipif(sys.platform != "win32", reason="normalização de \\ só existe no Windows")
def test_backslash_is_normalized_on_windows(project):
    assert resolve_safe_path(str(project), "docs\\plano.md") == os.path.realpath(
        str(project / "docs" / "plano.md")
    )


@pytest.mark.skipif(sys.platform != "win32", reason="letra de drive só existe no Windows")
def test_other_drive_is_refused_on_windows(project):
    drive = os.path.splitdrive(str(project))[0].upper()
    other = "D:" if drive != "D:" else "E:"
    with pytest.raises(OutsideProjectError):
        resolve_safe_path(str(project), other + "\\x.md")


@pytest.mark.skipif(sys.platform != "win32", reason="UNC só existe no Windows")
def test_unc_path_is_refused_before_touching_the_network(project, monkeypatch):
    # realpath de um UNC abriria conexão SMB: precisa ser recusado antes.
    calls = []
    real_realpath = os.path.realpath
    monkeypatch.setattr(os.path, "realpath", lambda p: calls.append(p) or real_realpath(p))
    with pytest.raises(OutsideProjectError):
        resolve_safe_path(str(project), "\\\\atacante\\share\\x.md")
    assert not any(str(c).startswith("\\\\atacante") for c in calls)


def test_directory_is_refused_with_is_a_directory_error(project):
    with pytest.raises(IsADirectoryError) as exc:
        resolve_safe_path(str(project), "docs")
    assert "docs" in str(exc.value)


def test_project_root_itself_is_a_directory_not_outside(project):
    with pytest.raises(IsADirectoryError):
        resolve_safe_path(str(project), ".")


def test_missing_file_raises_file_not_found_with_readable_message(project):
    with pytest.raises(FileNotFoundError) as exc:
        resolve_safe_path(str(project), "docs/x.md")
    assert str(exc.value) == "Arquivo não encontrado: docs/x.md"


_DENIED = [
    ".env",
    ".env.local",
    ".env.production",
    "config/.env",
    "certs/server.pem",
    "certs/server.key",
    "cert.p12",
    "cert.pfx",
    "id_rsa",
    "id_rsa.pub",
    "id_ed25519",
    "senhas.kdbx",
    ".git/config",
    "sub/.git/HEAD",
    ".npmrc",
    ".pypirc",
    "credentials.json",
    "credentials-prod.json",
    "sessions.db",
    "sessions.db-wal",
    "sessions.db-shm",
]


@pytest.mark.parametrize("rel", _DENIED)
def test_every_denylist_item_is_refused_when_it_exists(project, rel):
    target = project / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"segredo")
    with pytest.raises(ProtectedFileError) as exc:
        resolve_safe_path(str(project), rel)
    assert str(exc.value) == "Arquivo protegido (segredos não são exibidos)"


def test_denylist_is_checked_before_existence(project):
    # "Protegido" mesmo sem existir: a resposta não revela se há um .env.
    with pytest.raises(ProtectedFileError):
        resolve_safe_path(str(project), ".env")


@_symlinks
def test_symlink_with_innocent_name_pointing_to_a_secret_is_refused(project):
    (project / ".env").write_text("TOKEN=1", encoding="utf-8")
    (project / "config.txt").symlink_to(project / ".env")
    with pytest.raises(ProtectedFileError):
        resolve_safe_path(str(project), "config.txt")


@_symlinks
def test_symlink_named_like_a_secret_is_refused_even_if_target_is_harmless(project):
    (project / ".env").symlink_to(project / "README.md")
    with pytest.raises(ProtectedFileError):
        resolve_safe_path(str(project), ".env")


# -- is_denied -----------------------------------------------------------------


@pytest.mark.parametrize("rel", _DENIED + [".ENV", "Certs/Server.PEM", ".GIT/config"])
def test_is_denied_true(rel):
    assert is_denied(rel) is True


@pytest.mark.parametrize("rel", [
    ".env.example",
    "docs/.env.example",
    "env.md",
    ".envrc-notas.md",
    "README.md",
    "src/keys.py",
    "database.md",
    "gitignore.txt",
    ".gitignore",
    ".github/workflows/ci.yml",
    "id.md",
    "credentials.md",
    "",
])
def test_is_denied_false(rel):
    assert is_denied(rel) is False


# -- detect_kind / language_for ------------------------------------------------


@pytest.mark.parametrize("path,kind", [
    ("docs/plano.md", "markdown"),
    ("README.markdown", "markdown"),
    ("relatorio.html", "html"),
    ("pagina.htm", "html"),
    ("app.py", "code"),
    ("notas.txt", "code"),
    ("Dockerfile", "code"),
    ("sem-extensao", "code"),
    ("foto.PNG", "image"),
    ("diagrama.svg", "image"),
    ("manual.pdf", "pdf"),
    ("demo.mp4", "video"),
    ("pacote.zip", "binary"),
    ("fonte.woff2", "binary"),
])
def test_detect_kind_by_extension(path, kind):
    assert detect_kind(path, b"conteudo de texto\n") == kind


def test_null_byte_in_head_turns_text_kinds_into_binary():
    assert detect_kind("arquivo.md", b"abc\x00def") == "binary"
    assert detect_kind("arquivo.py", b"\x00") == "binary"
    assert detect_kind("arquivo.desconhecido", b"MZ\x90\x00") == "binary"


def test_null_byte_does_not_change_media_kinds():
    assert detect_kind("foto.png", b"\x89PNG\r\n\x1a\n\x00\x00") == "image"
    assert detect_kind("doc.pdf", b"%PDF-1.7\x00") == "pdf"


def test_only_the_first_head_bytes_are_considered():
    head = b"a" * HEAD_BYTES + b"\x00"
    assert detect_kind("grande.txt", head) == "code"


def test_is_text_kind():
    assert all(is_text_kind(k) for k in ("markdown", "html", "code"))
    assert not any(is_text_kind(k) for k in ("image", "pdf", "video", "binary"))


@pytest.mark.parametrize("path,language", [
    ("a.py", "python"),
    ("a.js", "javascript"),
    ("a.mjs", "javascript"),
    ("a.jsx", "jsx"),
    ("a.ts", "typescript"),
    ("a.tsx", "tsx"),
    ("a.json", "json"),
    ("a.css", "css"),
    ("a.html", "html"),
    ("a.sh", "bash"),
    ("a.ps1", "powershell"),
    ("a.yml", "yaml"),
    ("a.yaml", "yaml"),
    ("pyproject.toml", "toml"),
    ("schema.sql", "sql"),
    ("README.md", "markdown"),
    ("Dockerfile", "docker"),
    ("infra/Dockerfile", "docker"),
    ("Dockerfile.dev", "docker"),
    ("A.PY", "python"),
    ("notas.txt", "text"),
    ("sem-extensao", "text"),
])
def test_language_for(path, language):
    assert language_for(path) == language


# -- utilitários ---------------------------------------------------------------


def test_to_relative_posix_uses_forward_slashes(project):
    real = os.path.realpath(str(project / "docs" / "plano.md"))
    assert to_relative_posix(os.path.realpath(str(project)), real) == "docs/plano.md"


def test_is_within_directory_is_strict(tmp_path):
    child = tmp_path / "a" / "b"
    child.mkdir(parents=True)
    assert is_within_directory(str(tmp_path / "a"), str(child)) is True
    assert is_within_directory(str(tmp_path / "a"), str(tmp_path / "a")) is False
    assert is_within_directory(str(tmp_path / "a"), str(tmp_path)) is False


def test_project_dir_from_id(tmp_path):
    (tmp_path / "cliente" / "projeto").mkdir(parents=True)
    (tmp_path / "solto").mkdir()
    root = str(tmp_path)
    assert project_dir_from_id(root, "cliente/projeto") == os.path.join(root, "cliente", "projeto")
    assert project_dir_from_id(root, "solto") == os.path.join(root, "solto")


@pytest.mark.parametrize("project_id", [
    "", "nao-existe", "../fora", "cliente/../..", "cliente//projeto",
    "./cliente", "cliente\\projeto", "cliente\x00",
])
def test_project_dir_from_id_refuses_invalid_ids(tmp_path, project_id):
    (tmp_path / "cliente" / "projeto").mkdir(parents=True)
    (tmp_path.parent / "fora").mkdir(exist_ok=True)
    assert project_dir_from_id(str(tmp_path), project_id) is None


def test_project_dir_from_id_refuses_a_file(tmp_path):
    (tmp_path / "arquivo").write_text("x", encoding="utf-8")
    assert project_dir_from_id(str(tmp_path), "arquivo") is None
