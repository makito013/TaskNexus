"""Acesso seguro a arquivos de um projeto (Fase V, Parte 6 seção 6.4.2).

Tudo o que chega de fora — o `caminho` que o agente passa para a tool
`abrir_no_visualizador`, o link que o usuário toca num markdown, o
`{file_path}` da rota `/api/viewer/{item_id}/f/...` — passa por
`resolve_safe_path` antes de qualquer leitura. É o mesmo ponto único que a
aba Artefatos (Parte 7) e o navegador de arquivos (F1) vão reaproveitar, por
isso este módulo não conhece sessão, aba nem rota: só (raiz do projeto,
caminho).

Funções puras sobre o sistema de arquivos local, síncronas de propósito: quem
chama de dentro do event loop embrulha em `asyncio.to_thread` (stat, realpath
e leitura do cabeçalho são I/O de disco).

Compatibilidade: Python 3.9.6 no PC do Bruno — sem match/case, e `X | Y` só
em anotação (coberto pelo `from __future__ import annotations`).
"""
from __future__ import annotations

import os
import posixpath
import sys

# Quantos bytes do início do arquivo `detect_kind` olha para decidir entre
# texto e binário. 8 KB é a mesma janela que o git usa para a mesma pergunta.
HEAD_BYTES = 8192


# --- Erros -------------------------------------------------------------------
#
# A especificação pede PermissionError / FileNotFoundError / IsADirectoryError.
# As três subclasses de PermissionError abaixo existem porque quem chama
# precisa dar respostas DIFERENTES para cada motivo ("fora do projeto" não é
# "arquivo protegido"), e comparar texto de mensagem seria frágil. Continuam
# sendo PermissionError: um `except PermissionError` genérico pega todas.
#
# As mensagens são em português e sem caminho absoluto de propósito: elas vão
# direto para o agente (texto da tool) e para a tela, e não devem vazar onde o
# projeto mora no disco.


class InvalidPathError(PermissionError):
    """Caminho vazio ou com caractere proibido (`\\x00`, `\\` fora do Windows)."""


class OutsideProjectError(PermissionError):
    """O caminho resolve para fora da raiz do projeto."""

    def __init__(self, message: str = "Caminho fora do projeto"):
        super().__init__(message)


class ProtectedFileError(PermissionError):
    """O caminho cai na denylist de segredos (`is_denied`)."""

    def __init__(self, message: str = "Arquivo protegido (segredos não são exibidos)"):
        super().__init__(message)


# --- Contenção ---------------------------------------------------------------


def _contains(base: str, target: str, allow_equal: bool = False) -> bool:
    """`target` está dentro de `base`? Os dois já precisam vir normalizados
    (abspath ou realpath) — esta função só compara.

    `os.path.commonpath` levanta ValueError quando os dois caminhos nem
    compartilham o drive (Windows) ou misturam absoluto com relativo; para esta
    função isso é "não está contido", não um erro."""
    try:
        common = os.path.commonpath([base, target])
    except ValueError:
        return False
    if common != base:
        return False
    return allow_equal or target != base


def is_within_directory(base_dir: str, target: str) -> bool:
    """True só se `target` resolve para algum lugar ESTRITAMENTE dentro de
    `base_dir` — os dois lados passam por os.path.realpath() antes, então
    letras de drive, segmentos "..", symlinks e fragmentos relativos colapsam
    na mesma forma canônica antes da comparação.

    Extraída de attachments.py (era `_is_within_directory`) para ser a única
    checagem de contenção do backend. Uma lista de substrings proibidas (versão
    antiga dos anexos) só aproxima isto e deixa passar fugas específicas de
    plataforma — ex.: no Windows, os.path.join() descarta tudo antes de um
    componente que traz letra de drive ("C:\\attachments" + "D:\\evil" vira
    "D:\\evil"), e nenhuma lista de caracteres pega esse formato."""
    return _contains(os.path.realpath(base_dir), os.path.realpath(target))


def _normalize_separators(caminho: str) -> str:
    """Rejeita o que nunca é um caminho legítimo e normaliza a barra invertida.

    - `\\x00`: o sistema operacional trunca o caminho no NUL, então o que é
      checado e o que é aberto deixariam de ser o mesmo arquivo.
    - `\\`: no Windows é separador, então vira `/` (os dois funcionam lá). Fora
      do Windows ela é um caractere comum de nome de arquivo, mas nenhum
      agente/link legítimo manda isso, e aceitar abriria a porta para um
      caminho que significa uma coisa aqui e outra no Windows. O
      `RejectBackslashPathMiddleware` de main.py cuida da URL; o corpo JSON da
      tool não passa por ele, por isso a checagem existe aqui também.
    """
    if not isinstance(caminho, str) or not caminho.strip():
        raise InvalidPathError("Informe o caminho do arquivo.")
    if "\x00" in caminho:
        raise InvalidPathError("Caminho inválido (caractere proibido).")
    if "\\" in caminho:
        if sys.platform != "win32":
            raise InvalidPathError("Caminho inválido (use / como separador).")
        caminho = caminho.replace("\\", "/")
    return caminho.strip()


def project_dir_from_id(projects_root: str, project_id: str) -> str | None:
    """Pasta de um projeto a partir do `project_id` ("cliente/projeto"), sem
    varrer a árvore. None se o id for inválido ou a pasta não existir.

    É a mesma regra de construção de `scan_projects` (agent_discovery.py:
    `path = PROJECTS_ROOT / project_id`), só que direta. Existe porque as rotas
    que servem arquivos (`/api/viewer/{item_id}/f/...`) recebem uma requisição
    por asset de cada página HTML, e `scan_projects` faz um `os.walk` de
    PROJECTS_ROOT inteiro a cada chamada.

    O id vem do banco (gravado depois de validado), mas é tratado como
    não-confiável mesmo assim: segmentos vazios, `.`/`..`, barra invertida e
    NUL são recusados, e a pasta final precisa estar estritamente dentro de
    `projects_root` (id vazio apontaria para a raiz de TODOS os projetos)."""
    if not project_id or "\\" in project_id or "\x00" in project_id:
        return None
    parts = project_id.split("/")
    if any(part in ("", ".", "..") for part in parts):
        return None
    candidate = os.path.join(projects_root, *parts)
    if not is_within_directory(projects_root, candidate):
        return None
    if not os.path.isdir(candidate):
        return None
    return candidate


def to_relative_posix(project_root_real: str, real_path: str) -> str:
    """Caminho relativo à raiz do projeto, sempre com `/` — é o formato que vai
    para o banco, para a tela e para a URL `/f/<caminho>`, igual em todo SO."""
    return os.path.relpath(real_path, project_root_real).replace(os.sep, "/")


def resolve_safe_path(project_root: str, caminho: str) -> str:
    """Aceita caminho relativo à raiz do projeto ou absoluto DENTRO dela.
    Devolve o caminho real (realpath). Levanta:
      PermissionError  -> fora do projeto, caractere proibido, ou denylist
                          (InvalidPathError / OutsideProjectError / ProtectedFileError)
      FileNotFoundError -> não existe
      IsADirectoryError -> é pasta

    A ordem das checagens importa:

    1. Contenção LÉXICA antes de tocar no disco. No Windows, `realpath` de um
       caminho UNC (`\\\\host\\share\\x`) abre uma conexão SMB de saída e entrega
       o hash NTLM da conta para quem responder (mesmo problema que o
       RejectBackslashPathMiddleware fecha na URL). Recusar pelo formato antes
       garante que só caminhos que já parecem estar dentro do projeto chegam
       ao realpath.
    2. Contenção REAL (realpath dos dois lados): pega symlink apontando para
       fora do projeto.
    3. Denylist antes de checar existência: "Arquivo protegido" para `.env`
       exista ele ou não — não confirma a existência de segredo nenhum.
    4. Só então existência e tipo.
    """
    caminho = _normalize_separators(caminho)

    root_abs = os.path.abspath(project_root)
    root_real = os.path.realpath(root_abs)
    # join() com um segundo argumento absoluto devolve o segundo — então os
    # dois casos (relativo à raiz / absoluto) saem da mesma linha. abspath
    # normaliza ".." de forma puramente léxica (GetFullPathNameW no Windows,
    # sem acesso à rede).
    candidate = os.path.abspath(os.path.join(root_abs, caminho))

    # A raiz pode ser symlink (ex.: /var -> /private/var no macOS), e o agente
    # pode mandar o caminho absoluto por qualquer um dos dois lados.
    lexical_root = None
    if _contains(root_abs, candidate, allow_equal=True):
        lexical_root = root_abs
    elif _contains(root_real, candidate, allow_equal=True):
        lexical_root = root_real
    if lexical_root is None:
        raise OutsideProjectError()

    real = os.path.realpath(candidate)
    if not _contains(root_real, real, allow_equal=True):
        raise OutsideProjectError()

    # Os DOIS nomes passam pela denylist: o pedido (um symlink chamado
    # `config.txt` apontando para `.env` é pego pelo real; um link chamado
    # `.env` é pego pelo pedido). Recusar a mais nunca expõe nada.
    lexical_rel = to_relative_posix(lexical_root, candidate)
    real_rel = to_relative_posix(root_real, real)
    if is_denied(lexical_rel) or is_denied(real_rel):
        raise ProtectedFileError()

    if not os.path.exists(real):
        raise FileNotFoundError(f"Arquivo não encontrado: {caminho}")
    if os.path.isdir(real):
        raise IsADirectoryError(f"É uma pasta, não um arquivo: {caminho}")
    return real


# --- Denylist de segredos ----------------------------------------------------

# Comparação sempre em minúsculas: Windows e macOS têm sistema de arquivos sem
# distinção de caixa, então `.ENV` é o mesmo arquivo que `.env`.
_DENIED_NAMES = frozenset({".npmrc", ".pypirc"})
_DENIED_SUFFIXES = (
    ".pem", ".key", ".p12", ".pfx", ".kdbx", ".db", ".db-wal", ".db-shm",
)
_DENIED_PREFIXES = ("id_rsa", "id_ed25519")
_ALLOWED_ENV_NAMES = frozenset({".env.example"})


def is_denied(rel_path: str) -> bool:
    """O caminho (relativo à raiz do projeto, `/` ou separador do SO) é um
    arquivo que o visualizador NUNCA mostra, mesmo dentro do projeto.

    A lista vem da Parte 6, seção 6.4.2: `.env` e `.env.*` (menos
    `.env.example`), chaves e certificados, cofres de senha, configs com token
    de registro de pacote, credenciais de nuvem, bancos SQLite (o próprio
    sessions.db do TaskNexus pode morar dentro de um projeto) e qualquer coisa
    dentro de `.git/`.
    """
    parts = [p for p in rel_path.replace("\\", "/").split("/") if p not in ("", ".")]
    if not parts:
        return False
    lowered = [p.lower() for p in parts]
    if ".git" in lowered:
        return True
    name = lowered[-1]
    if name == ".env" or (name.startswith(".env.") and name not in _ALLOWED_ENV_NAMES):
        return True
    if name in _DENIED_NAMES:
        return True
    if name.endswith(_DENIED_SUFFIXES):
        return True
    if name.startswith(_DENIED_PREFIXES):
        return True
    if name.startswith("credentials") and name.endswith(".json"):
        return True
    return False


# --- Tipo e linguagem --------------------------------------------------------

_KIND_BY_EXT = {
    ".md": "markdown", ".markdown": "markdown", ".mdown": "markdown", ".mkd": "markdown",
    ".html": "html", ".htm": "html", ".xhtml": "html",
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image",
    ".webp": "image", ".bmp": "image", ".ico": "image", ".avif": "image",
    ".svg": "image",
    ".pdf": "pdf",
    ".mp4": "video", ".webm": "video", ".mov": "video", ".m4v": "video", ".ogv": "video",
}

# Formatos que são binários por definição: não adianta olhar o conteúdo (um
# zip pequeno pode não ter NUL nos primeiros 8 KB e ser exibido como texto).
_BINARY_EXTS = frozenset({
    ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".tar",
    ".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".a", ".class", ".jar",
    ".pyc", ".pyo", ".whl",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp",
    ".sqlite", ".sqlite3", ".db", ".heic", ".tif", ".tiff", ".psd",
})

_TEXT_KINDS = frozenset({"markdown", "html", "code"})


def detect_kind(path: str, head_bytes: bytes) -> str:
    """`markdown | html | code | image | pdf | video | binary`, pela extensão.

    `head_bytes` são os primeiros bytes do arquivo (até HEAD_BYTES). Um `\\x00`
    ali faz qualquer tipo TEXTUAL virar `binary` — é o mesmo critério do git, e
    evita mandar lixo para o destaque de sintaxe quando um `.md` é na verdade
    outra coisa. Imagem, PDF e vídeo são binários por natureza e ficam pela
    extensão. Extensão desconhecida sem NUL vira `code` (texto puro, com
    `language_for` devolvendo `text`)."""
    ext = os.path.splitext(path)[1].lower()
    kind = _KIND_BY_EXT.get(ext)
    if kind is not None and kind not in _TEXT_KINDS:
        return kind
    if ext in _BINARY_EXTS:
        return "binary"
    if b"\x00" in head_bytes[:HEAD_BYTES]:
        return "binary"
    return kind or "code"


def is_text_kind(kind: str) -> bool:
    """Os tipos cujo conteúdo a rota `content` devolve como texto."""
    return kind in _TEXT_KINDS


# Ids de linguagem no formato do Shiki (o destaque de sintaxe escolhido para a
# Fase V, seção 6.5.5). Os 15 primeiros são a lista da especificação; o resto
# são extras baratos para linguagens comuns nos projetos do Bruno.
_LANGUAGE_BY_EXT = {
    ".py": "python",
    ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".jsx": "jsx",
    ".ts": "typescript", ".mts": "typescript", ".cts": "typescript",
    ".tsx": "tsx",
    ".json": "json",
    ".css": "css",
    ".html": "html", ".htm": "html", ".xhtml": "html",
    ".sh": "bash", ".bash": "bash", ".zsh": "bash",
    ".ps1": "powershell", ".psm1": "powershell",
    ".yml": "yaml", ".yaml": "yaml",
    ".toml": "toml",
    ".sql": "sql",
    ".md": "markdown", ".markdown": "markdown",
    # extras
    ".scss": "scss", ".sass": "sass", ".less": "less",
    ".xml": "xml", ".svg": "xml",
    ".go": "go", ".rs": "rust", ".java": "java", ".kt": "kotlin",
    ".rb": "ruby", ".php": "php", ".cs": "csharp", ".swift": "swift",
    ".c": "c", ".h": "c", ".cpp": "cpp", ".cc": "cpp", ".hpp": "cpp",
    ".lua": "lua", ".vue": "vue", ".svelte": "svelte",
    ".ini": "ini", ".cfg": "ini", ".bat": "bat", ".cmd": "bat",
    ".diff": "diff", ".patch": "diff",
}
_LANGUAGE_BY_NAME = {
    "dockerfile": "docker",
    "makefile": "make",
}


def language_for(path: str) -> str:
    """Id de linguagem para o destaque de sintaxe; `text` quando não sabe.

    Pelo NOME antes da extensão: `Dockerfile` não tem extensão, e
    `Dockerfile.dev` / `api.Dockerfile` também são Docker."""
    name = posixpath.basename(path.replace("\\", "/")).lower()
    if name in _LANGUAGE_BY_NAME:
        return _LANGUAGE_BY_NAME[name]
    if name.startswith("dockerfile.") or name.endswith(".dockerfile"):
        return "docker"
    ext = os.path.splitext(name)[1]
    return _LANGUAGE_BY_EXT.get(ext, "text")
