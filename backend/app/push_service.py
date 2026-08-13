from __future__ import annotations

import asyncio
import json

"""Web Push delivery (Phase 3, Task 5).

`pywebpush` is imported LAZILY inside `_send_one`, never at module level:
app/main.py imports this module at boot, and a hard import would take the
whole backend down on a machine without the dependency installed (Risk R-2).

`pywebpush` sits on `requests`, which has no default timeout — and pywebpush's
own default is `timeout=10000`, which lands in `requests.post(timeout=...)`
as TEN THOUSAND SECONDS (~2.8h), not milliseconds. An explicit timeout is
therefore not a nicety here, it's what stops a single unreachable push
service from parking a thread for the rest of the day (Risk R-4).
"""

# Seconds. Push services answer in well under a second normally; anything
# past this is a network problem, and the notification is already stale.
PUSH_TIMEOUT_SECONDS = 10.0

# The push service telling us this subscription is gone for good. Anything
# else (500, 429, a timeout) is transient and must NOT delete the device —
# losing a subscription means the user has to re-enable push by hand.
GONE_STATUS_CODES = frozenset({404, 410})


def _build_signer(private_pem: str):
    """Parses the stored PEM into the object pywebpush signs with.

    ⚠️ The PEM string can NOT be handed to `webpush(vapid_private_key=...)`
    directly, despite what its docstring ("path to vapid private key PEM or
    encoded str") suggests: with a value that isn't an existing file path,
    pywebpush calls `Vapid.from_string`, which base64-DECODES the argument
    and parses it as DER — a PEM blob dies there with "ASN.1 parsing error:
    invalid length". Every unit test in this suite mocks `webpush`, so this
    would only ever have failed in production. `Vapid02.from_pem` is the
    path that actually accepts what we persist.

    Built fresh per delivery rather than cached on VapidKeys: deliveries run
    concurrently in worker threads (`asyncio.to_thread`), and parsing an EC
    key is far cheaper than reasoning about whether py_vapid's signing state
    is thread-safe.
    """
    from py_vapid import Vapid02

    return Vapid02.from_pem(private_pem.encode("utf-8"))


def _send_one(subscription: dict, payload: dict, vapid_keys, timeout: float) -> None:
    """Blocking single delivery. Runs in a worker thread (see below).

    Raises `pywebpush.WebPushException` on any non-2xx response — that's
    pywebpush's documented contract ("Any non-success will throw a
    WebPushException").
    """
    from pywebpush import webpush

    webpush(
        subscription_info={
            "endpoint": subscription["endpoint"],
            "keys": {"p256dh": subscription["p256dh"], "auth": subscription["auth"]},
        },
        data=json.dumps(payload),
        vapid_private_key=_build_signer(vapid_keys.private_pem),
        # A fresh dict per call on purpose: pywebpush writes the endpoint's
        # origin into `aud`, so a shared dict would carry the first
        # endpoint's audience into every later one.
        vapid_claims={"sub": vapid_keys.subject},
        timeout=timeout,
    )


def _status_code_of(exception) -> int | None:
    """Status code carried by a WebPushException, when there is one.

    A local failure (bad key material, an encryption error) raises the same
    exception type with `response = None`. Reading `.status_code` off that
    unguarded would raise AttributeError inside the except block and abort
    the very loop this function exists to protect.
    """
    response = getattr(exception, "response", None)
    return getattr(response, "status_code", None)


async def send_push_to_all(
    payload: dict,
    *,
    store,
    vapid_keys,
    timeout: float = PUSH_TIMEOUT_SECONDS,
) -> dict:
    """Delivers `payload` to every registered subscription.

    Returns a `{"sent", "failed", "pruned"}` summary — used by tests and by
    the boot log, never branched on by the caller: this runs detached in a
    background task, so there is nobody left to react to a failure.

    One device failing never aborts the others: each delivery is wrapped
    individually. Subscriptions the push service reports as gone (404/410)
    are pruned in the same pass, which is the only garbage collection these
    rows ever get.
    """
    summary = {"sent": 0, "failed": 0, "pruned": 0}
    try:
        subscriptions = await store.list_all()
    except Exception as exc:  # pragma: no cover - defensive, DB-level failure
        print(f"==> AVISO: push não enviado (falha ao ler subscriptions): {exc!r}", flush=True)
        return summary

    for subscription in subscriptions:
        endpoint = subscription["endpoint"]
        try:
            # to_thread: pywebpush is synchronous (requests + the ECE
            # encryption of the payload). Calling it inline would block the
            # event loop — and therefore every open terminal websocket —
            # for the whole round trip to FCM/APNs.
            await asyncio.to_thread(_send_one, subscription, payload, vapid_keys, timeout)
            summary["sent"] += 1
            await store.touch_success(endpoint)
        except Exception as exc:
            status_code = _status_code_of(exc)
            if status_code in GONE_STATUS_CODES:
                await store.delete(endpoint)
                summary["pruned"] += 1
            else:
                summary["failed"] += 1
                print(
                    f"==> AVISO: falha ao enviar push para {endpoint[:60]}… "
                    f"(status={status_code}): {exc!r}",
                    flush=True,
                )
    return summary
