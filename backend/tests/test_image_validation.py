"""Testes para backend/app/image_validation.py."""
from __future__ import annotations

import pytest

from app.image_validation import (
    UploadTooLargeError,
    sniff_image_type,
    validate_upload_stream,
)


def _pad(data: bytes, minimum: int = 12) -> bytes:
    """Preenche `data` com zeros até atingir o tamanho mínimo esperado."""
    if len(data) >= minimum:
        return data
    return data + b"\x00" * (minimum - len(data))


class TestSniffImageType:
    def test_recognizes_png(self):
        head = _pad(b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR")
        assert sniff_image_type(head) == "image/png"

    def test_recognizes_jpeg(self):
        head = _pad(b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01")
        assert sniff_image_type(head) == "image/jpeg"

    def test_recognizes_gif87a(self):
        head = _pad(b"GIF87a\x00\x00\x00\x00\x00\x00")
        assert sniff_image_type(head) == "image/gif"

    def test_recognizes_gif89a(self):
        head = _pad(b"GIF89a\x00\x00\x00\x00\x00\x00")
        assert sniff_image_type(head) == "image/gif"

    def test_recognizes_webp(self):
        # bytes 0-4 = "RIFF", 4-8 = tamanho (irrelevante aqui), 8-12 = "WEBP"
        head = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP"
        assert sniff_image_type(head) == "image/webp"

    @pytest.mark.parametrize("brand", [b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"])
    def test_recognizes_heic_brands(self, brand):
        # bytes 0-4 = tamanho do box (irrelevante), 4-8 = "ftyp", 8-12 = brand
        head = b"\x00\x00\x00\x18" + b"ftyp" + brand
        assert sniff_image_type(head) == "image/heic"

    def test_unrecognized_random_bytes_returns_none(self):
        head = _pad(b"\x01\x02\x03\x04\x05\x06\x07\x08")
        assert sniff_image_type(head) is None

    def test_empty_bytes_returns_none(self):
        assert sniff_image_type(b"") is None

    def test_short_bytes_do_not_raise_and_return_none(self):
        # Menos de 12 bytes: não deve levantar IndexError, mesmo com
        # prefixos que parecem válidos para as assinaturas mais longas.
        assert sniff_image_type(b"\x89PNG") is None
        assert sniff_image_type(b"\x00\x00\x00\x00ftyp") is None

    def test_webp_requires_both_riff_and_webp_markers(self):
        # "RIFF" presente mas sem "WEBP" na posição correta.
        head = b"RIFF" + b"\x00\x00\x00\x00" + b"AVI "
        assert sniff_image_type(head) is None


class _FakeUploadFile:
    """Simula um UploadFile do FastAPI: `.read(n)` assíncrono que serve
    chunks pré-definidos de uma lista, ignorando o tamanho pedido."""

    def __init__(self, chunks: list[bytes]):
        self._chunks = list(chunks)
        self._index = 0

    async def read(self, chunk_size: int = -1) -> bytes:
        if self._index >= len(self._chunks):
            return b""
        chunk = self._chunks[self._index]
        self._index += 1
        return chunk


class TestValidateUploadStream:
    @pytest.mark.asyncio
    async def test_returns_full_bytes_when_within_limit(self):
        fake = _FakeUploadFile([b"a" * 30, b"b" * 30, b"c" * 30])
        result = await validate_upload_stream(fake, max_bytes=1000)
        assert result == b"a" * 30 + b"b" * 30 + b"c" * 30

    @pytest.mark.asyncio
    async def test_aborts_when_exceeding_max_bytes(self):
        # max_bytes pequeno para não precisar de payload real de 5MB.
        fake = _FakeUploadFile([b"x" * 60, b"y" * 60])
        with pytest.raises(UploadTooLargeError):
            await validate_upload_stream(fake, max_bytes=100)

    @pytest.mark.asyncio
    async def test_does_not_trust_content_length_header(self):
        # Mesmo que um eventual header dissesse "arquivo pequeno", a
        # validação deve contar os bytes reais lidos e abortar.
        fake = _FakeUploadFile([b"z" * 200])
        with pytest.raises(UploadTooLargeError):
            await validate_upload_stream(fake, max_bytes=100)

    @pytest.mark.asyncio
    async def test_empty_file_returns_empty_bytes(self):
        fake = _FakeUploadFile([])
        result = await validate_upload_stream(fake, max_bytes=100)
        assert result == b""
