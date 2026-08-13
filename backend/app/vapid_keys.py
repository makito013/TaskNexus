from __future__ import annotations

import base64
import os
from dataclasses import dataclass

"""VAPID keypair provisioning for Web Push (Phase 3, decision G-1).

The keypair is GENERATED ON FIRST BOOT and persisted, never typed into .env
by hand. That decision has one consequence worth stating up front, because
it inverts what the original plan assumed: "no keys configured" is no longer
the no-op path — after the first boot the keys always exist. The real no-op
path is "no subscription registered", which is what the caller checks.

Every import of `py_vapid`/`cryptography` in this module is LAZY (inside the
function that needs it), on purpose: `app/main.py` imports this module at
module level, and a top-level import of a dependency that isn't installed
would take the entire backend down at boot on a machine that only wanted the
terminal (Risk R-2). Missing dependency degrades to "push unavailable", not
to a dead process.
"""


@dataclass(frozen=True)
class VapidKeys:
    """The provisioned keypair, in the exact shapes the two consumers need.

    - `private_pem`: what `pywebpush.webpush(vapid_private_key=...)` signs with.
    - `public_key`: the base64url (unpadded) uncompressed EC point that the
      BROWSER expects as `applicationServerKey` in `pushManager.subscribe()`.
      It is NOT the PEM public key — passing the PEM there fails with an
      opaque DOMException in the browser.
    - `subject`: the `sub` VAPID claim. Push services require a
      mailto:/https: URL identifying the sender.
    """

    private_pem: str
    public_key: str
    subject: str


# Push services only require `sub` to be a syntactically valid mailto:/https:
# URI — they don't verify it resolves. This default keeps a personal tailnet
# install working with zero configuration; VAPID_SUBJECT overrides it.
DEFAULT_VAPID_SUBJECT = "mailto:tasknexus@localhost"


def vapid_subject() -> str:
    return os.getenv("VAPID_SUBJECT") or DEFAULT_VAPID_SUBJECT


def generate_vapid_keypair() -> dict[str, str]:
    """Generates a fresh P-256 keypair.

    Raises ImportError when py_vapid/cryptography are missing — the caller
    (`load_or_create_vapid_keys`) is what turns that into a degraded no-op.
    """
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid02

    vapid = Vapid02()
    vapid.generate_keys()
    raw_public_point = vapid.public_key.public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    return {
        "private_pem": vapid.private_pem().decode("utf-8"),
        "public_key": base64.urlsafe_b64encode(raw_public_point).decode("ascii").rstrip("="),
    }


async def load_or_create_vapid_keys(store) -> VapidKeys | None:
    """Reads the persisted keypair, generating and saving one on first boot.

    Returns None (never raises) when the keys can't be provisioned — a
    missing dependency, or a database that refuses the write. Push is simply
    unavailable in that case; nothing else in the app is affected.

    `store` is any object exposing `get_vapid_keys()`/`save_vapid_keys()` —
    in production it's PushSubscriptionStore. Note the re-read after saving:
    with two processes booting at once, `save_vapid_keys` is INSERT OR
    IGNORE, so the loser of that race must end up using the pair that
    actually landed, not the one it generated and threw away.
    """
    try:
        stored = await store.get_vapid_keys()
        if stored is None:
            generated = generate_vapid_keypair()
            await store.save_vapid_keys(
                private_pem=generated["private_pem"],
                public_key=generated["public_key"],
            )
            stored = await store.get_vapid_keys() or generated
        return VapidKeys(
            private_pem=stored["private_pem"],
            public_key=stored["public_key"],
            subject=vapid_subject(),
        )
    except ImportError as exc:
        print(f"==> AVISO: Web Push desativado (dependência ausente): {exc}", flush=True)
        return None
    except Exception as exc:  # pragma: no cover - defensive, DB-level failure
        print(f"==> AVISO: Web Push desativado (falha ao provisionar chaves VAPID): {exc!r}", flush=True)
        return None
