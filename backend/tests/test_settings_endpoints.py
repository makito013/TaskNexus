"""Testes de integração para GET/PUT /api/settings/appearance (Milestone 1
do plano de Layout v2, 05-TL.md). Mesmo padrão de fixture `client` de
test_agents_endpoints.py: reload de app.main com SESSIONS_DB apontando pra um
arquivo novo em tmp_path, garantindo DB isolado por teste."""
import os
import pytest
from unittest.mock import patch


@pytest.fixture
def client(tmp_path):
    with patch.dict("os.environ", {
        "PROJECTS_ROOT": str(tmp_path),
        "SESSIONS_DB": str(tmp_path / "sessions.db"),
        "CLAUDE_CONFIG_PATH": str(tmp_path / "claude.json"),
        "CLEANUP_DELAY": "0.1",
    }):
        import importlib
        from fastapi.testclient import TestClient
        import app.main as main_mod
        importlib.reload(main_mod)
        from app.main import app
        with TestClient(app) as c:
            yield c


def test_get_appearance_returns_defaults_on_fresh_db(client):
    r = client.get("/api/settings/appearance")
    assert r.status_code == 200
    assert r.json() == {"layout_version": "v2", "theme_mode": "light"}


def test_put_partial_update_persists_and_reflects_on_next_get(client):
    r = client.put("/api/settings/appearance", json={"theme_mode": "dark"})
    assert r.status_code == 200
    body = r.json()
    assert body == {"layout_version": "v2", "theme_mode": "dark"}

    r2 = client.get("/api/settings/appearance")
    assert r2.status_code == 200
    assert r2.json() == {"layout_version": "v2", "theme_mode": "dark"}


def test_put_both_fields_persists_both(client):
    r = client.put(
        "/api/settings/appearance",
        json={"layout_version": "v2", "theme_mode": "light"},
    )
    assert r.status_code == 200
    assert r.json() == {"layout_version": "v2", "theme_mode": "light"}


def test_put_invalid_layout_version_returns_422(client):
    r = client.put("/api/settings/appearance", json={"layout_version": "v3"})
    assert r.status_code == 422


def test_put_invalid_theme_mode_returns_422(client):
    r = client.put("/api/settings/appearance", json={"theme_mode": "blue"})
    assert r.status_code == 422


def test_put_empty_body_is_a_noop(client):
    """PUT sem nenhum campo não deve alterar nada nem quebrar — os dois
    argumentos de update() chegam como None e COALESCE preserva os valores
    atuais (ver SettingsStore.update)."""
    r = client.put("/api/settings/appearance", json={})
    assert r.status_code == 200
    assert r.json() == {"layout_version": "v2", "theme_mode": "light"}


def test_get_projects_root_returns_env_var_as_resolved_path_when_no_override(client, tmp_path):
    r = client.get("/api/settings/projects-root")
    assert r.status_code == 200
    body = r.json()
    assert body["projects_root_path"] is None
    assert body["resolved_path"] == str(tmp_path)


def test_put_projects_root_persists_and_reflects_on_next_get(client, tmp_path):
    new_root = tmp_path / "outro-disco"
    new_root.mkdir()
    r = client.put("/api/settings/projects-root", json={"projects_root_path": str(new_root)})
    assert r.status_code == 200
    body = r.json()
    assert body["projects_root_path"] == str(new_root)
    assert body["resolved_path"] == str(new_root)

    r2 = client.get("/api/settings/projects-root")
    assert r2.json()["projects_root_path"] == str(new_root)


def test_put_projects_root_rejects_nonexistent_path(client, tmp_path):
    r = client.put("/api/settings/projects-root", json={"projects_root_path": str(tmp_path / "nao-existe")})
    assert r.status_code == 400


def test_put_projects_root_updates_live_project_scanning(client, tmp_path):
    """Depois do PUT, GET /api/projects deve escanear a NOVA pasta, não a
    antiga — prova que _reload_projects_root() de fato substitui a
    constante PROJECTS_ROOT usada por scan_projects, não só o valor
    devolvido por este endpoint."""
    new_root = tmp_path / "nova-pasta-projetos"
    (new_root / "meu-projeto" / ".claude").mkdir(parents=True)
    client.put("/api/settings/projects-root", json={"projects_root_path": str(new_root)})

    r = client.get("/api/projects")
    assert r.status_code == 200
    ids = [p["id"] for p in r.json()]
    assert "meu-projeto" in ids


def test_browse_projects_root_returns_picked_path(client):
    from unittest.mock import patch
    with patch("app.main._pick_projects_folder", return_value="/algum/caminho/escolhido"):
        r = client.post("/api/settings/projects-root/browse")
    assert r.status_code == 200
    assert r.json() == {"path": "/algum/caminho/escolhido"}


def test_browse_projects_root_returns_null_path_when_cancelled(client):
    from unittest.mock import patch
    with patch("app.main._pick_projects_folder", return_value=None):
        r = client.post("/api/settings/projects-root/browse")
    assert r.status_code == 200
    assert r.json() == {"path": None}


def test_put_projects_root_normalizes_forward_slash_path(client, tmp_path):
    """tkinter.filedialog.askdirectory() devolve paths com barra normal no
    Windows mesmo pra discos locais (ex: "D:/projetos") — persistir esse
    valor cru quebra o lookup por path de _pretrust_projects em
    ~/.claude.json (scan_projects/os.walk produzem paths com separador
    nativo). O handler do PUT precisa normalizar antes de persistir.

    O path "sujo" usa barra normal + um segmento "." final redundante —
    normpath colapsa os dois. Combinar os dois (em vez de só trocar a
    barra) garante que a asserção seja significativa tanto no Windows
    quanto no POSIX: só trocar "\\" por "/" seria um no-op no POSIX (onde
    "/" já é o separador nativo), passando mesmo sem a normalização."""
    new_root = tmp_path / "outro-disco"
    new_root.mkdir()
    messy_path = str(new_root).replace(os.sep, "/") + "/."
    r = client.put("/api/settings/projects-root", json={"projects_root_path": messy_path})
    assert r.status_code == 200
    expected = os.path.normpath(os.path.abspath(messy_path))
    assert expected != messy_path  # confirma que o path realmente estava "sujo"
    assert r.json()["projects_root_path"] == expected

    r2 = client.get("/api/settings/projects-root")
    assert r2.json()["projects_root_path"] == expected


def test_get_notifications_returns_defaults_with_derived_fields(client):
    r = client.get("/api/settings/notifications")
    assert r.status_code == 200
    body = r.json()
    assert body["quiet_hours_enabled"] is False
    assert body["quiet_hours_start"] == "22:00"
    assert body["quiet_hours_end"] == "07:00"
    # Derived from the server's clock, not persisted — just checks it came
    # back and is a plausible timezone (the exact value depends on the
    # machine running the test).
    assert -12 * 60 <= body["server_utc_offset_minutes"] <= 14 * 60
    # With quiet_hours_enabled = False it's never a quiet-hours window, no
    # matter what time this test happens to run at.
    assert body["quiet_hours_active"] is False


def test_put_notifications_persists_and_reflects_on_next_get(client):
    r = client.put(
        "/api/settings/notifications",
        json={"quiet_hours_enabled": True, "quiet_hours_start": "23:00", "quiet_hours_end": "06:30"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["quiet_hours_enabled"] is True
    assert body["quiet_hours_start"] == "23:00"
    assert body["quiet_hours_end"] == "06:30"

    r2 = client.get("/api/settings/notifications")
    assert r2.json()["quiet_hours_start"] == "23:00"
    assert r2.json()["quiet_hours_enabled"] is True


def test_put_notifications_partial_update_keeps_the_other_fields(client):
    client.put(
        "/api/settings/notifications",
        json={"quiet_hours_enabled": True, "quiet_hours_start": "23:00", "quiet_hours_end": "06:30"},
    )
    r = client.put("/api/settings/notifications", json={"quiet_hours_enabled": False})
    assert r.status_code == 200
    body = r.json()
    # Turning the window off does NOT erase the configured time — that's
    # precisely why `quiet_hours_enabled` is its own field instead of a
    # start == end sentinel.
    assert body == {
        **body,
        "quiet_hours_enabled": False,
        "quiet_hours_start": "23:00",
        "quiet_hours_end": "06:30",
    }


def test_put_notifications_rejects_invalid_time_format(client):
    r = client.put("/api/settings/notifications", json={"quiet_hours_start": "25:00"})
    assert r.status_code == 422
    r2 = client.put("/api/settings/notifications", json={"quiet_hours_end": "sete horas"})
    assert r2.status_code == 422


def test_put_empty_notifications_body_is_a_noop(client):
    r = client.put("/api/settings/notifications", json={})
    assert r.status_code == 200
    assert r.json()["quiet_hours_enabled"] is False
    assert r.json()["quiet_hours_start"] == "22:00"


def test_quiet_hours_active_is_computed_from_the_server_clock(client):
    """Proves that `quiet_hours_active` comes from the pure function applied
    to the server's clock, not from a persisted value: with the window on
    and covering the test's instant (pinned via a patch on time.time in the
    main module), the field has to come back True."""
    from unittest.mock import patch
    import app.main as main_mod
    from app.quiet_hours import current_utc_offset_minutes

    client.put(
        "/api/settings/notifications",
        json={"quiet_hours_enabled": True, "quiet_hours_start": "22:00", "quiet_hours_end": "07:00"},
    )
    # 23:30 in the server's local timezone, whatever it is.
    offset = current_utc_offset_minutes()
    inside_epoch = ((23 * 60 + 30) - offset) * 60
    with patch.object(main_mod.time, "time", return_value=inside_epoch):
        r = client.get("/api/settings/notifications")
    assert r.json()["quiet_hours_active"] is True

    outside_epoch = ((12 * 60) - offset) * 60
    with patch.object(main_mod.time, "time", return_value=outside_epoch):
        r2 = client.get("/api/settings/notifications")
    assert r2.json()["quiet_hours_active"] is False


def test_hook_stop_still_marks_needs_attention_during_quiet_hours(client):
    """The quiet-hours window mutes SOUND and notification, never the
    badge/title.

    Gating `needs_attention` behind the Stop hook would erase the only
    surface left when notification permission is denied — and which the PO
    required to persist until dismissed by hand. The user would wake up with
    no record that the chat finished. Whoever consults the quiet-hours
    window is the DELIVERY CHANNEL (sound/Notification, in the frontend),
    not the event record.

    This test is the guard-rail for that decision: if someone wraps
    `mark_needs_attention` in an `if not quiet_hours`, it breaks."""
    from unittest.mock import AsyncMock, patch
    import app.main as main_mod
    from app.quiet_hours import current_utc_offset_minutes

    # Window covering the whole day, with the server clock frozen to a fixed
    # instant guaranteed to fall inside it — same pattern as
    # test_quiet_hours_active_is_computed_from_the_server_clock above. With
    # an exclusive end, "23:59" leaves the 23:59:00-23:59:59 minute outside
    # the window; freezing the clock (instead of trusting whatever real
    # wall-clock time this test happens to run at) removes that gap.
    client.put(
        "/api/settings/notifications",
        json={"quiet_hours_enabled": True, "quiet_hours_start": "00:00", "quiet_hours_end": "23:59"},
    )
    offset = current_utc_offset_minutes()
    inside_epoch = ((12 * 60) - offset) * 60  # noon local, safely inside 00:00-23:59

    with patch.object(main_mod.time, "time", return_value=inside_epoch), patch.object(
        main_mod.store, "get_session_key_by_claude_id", AsyncMock(return_value="proj::claude")
    ), patch.object(main_mod.store, "mark_needs_attention", AsyncMock()) as mark:
        r = client.post("/api/hooks/stop", json={"session_id": "uuid-conhecido"})

    assert r.status_code == 200
    mark.assert_awaited_once_with("proj::claude")


def test_put_projects_root_re_pretrusts_projects_in_new_root(client, tmp_path):
    """Depois de um PUT bem-sucedido, _pretrust_projects() precisa rodar de
    novo — o frontend só recarrega o BROWSER (window.location.reload()), não
    reinicia o processo backend, então sem isso todo projeto na pasta
    recém-escolhida nunca ganha hasTrustDialogAccepted, e o diálogo de
    confiança do workspace do Claude Code reapareceria pra cada um."""
    new_root = tmp_path / "nova-pasta-pretrust"
    (new_root / "meu-projeto" / ".claude").mkdir(parents=True)
    with patch("app.main._pretrust_projects") as mock_pretrust:
        r = client.put("/api/settings/projects-root", json={"projects_root_path": str(new_root)})
    assert r.status_code == 200
    mock_pretrust.assert_called_once()
