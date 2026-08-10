"""Validação pura de imagens anexadas a cards do board.

Módulo sem I/O de rede e sem dependências fora da stdlib — apenas
sniffing de assinatura de bytes (magic numbers) e leitura segura de
upload em chunks, sem confiar em `Content-Length`.
"""
from __future__ import annotations

_HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"}

_MIN_HEIC_BYTES = 12


def sniff_image_type(head_bytes: bytes) -> str | None:
    """Detecta o mime type de uma imagem a partir dos primeiros bytes.

    Recebe os bytes iniciais de um arquivo (idealmente pelo menos 12
    bytes — necessário para reconhecer HEIC/HEIF) e retorna o mime type
    detectado, ou `None` se nenhuma assinatura conhecida for reconhecida.
    Nunca levanta `IndexError`: assinaturas que exigem mais bytes do que
    os fornecidos simplesmente não são reconhecidas.
    """
    if head_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"

    if head_bytes[:3] == b"\xff\xd8\xff":
        return "image/jpeg"

    if head_bytes[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"

    if head_bytes[:4] == b"RIFF" and head_bytes[8:12] == b"WEBP":
        return "image/webp"

    if len(head_bytes) >= _MIN_HEIC_BYTES and head_bytes[4:8] == b"ftyp" and head_bytes[8:12] in _HEIC_BRANDS:
        return "image/heic"

    return None


class UploadTooLargeError(Exception):
    """Levantada quando um upload excede o limite de bytes permitido."""


async def validate_upload_stream(file, max_bytes: int = 5 * 1024 * 1024) -> bytes:
    """Lê um upload em chunks, abortando se ultrapassar `max_bytes`.

    `file` é qualquer objeto com um método `.read(chunk_size)` assíncrono
    (como um `UploadFile` do FastAPI/Starlette). Nunca confia no header
    `Content-Length` — o limite é aplicado contando os bytes realmente
    lidos, chunk a chunk. Levanta `UploadTooLargeError` assim que o total
    acumulado ultrapassa `max_bytes`; caso contrário retorna os bytes
    completos do arquivo.
    """
    chunk_size = 64 * 1024
    chunks: list[bytes] = []
    total = 0

    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break

        total += len(chunk)
        if total > max_bytes:
            raise UploadTooLargeError(
                f"Upload excede o limite de {max_bytes} bytes"
            )

        chunks.append(chunk)

    return b"".join(chunks)
