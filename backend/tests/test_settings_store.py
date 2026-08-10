import pytest
import pytest_asyncio
from app.settings_store import SettingsStore


@pytest_asyncio.fixture
async def store(tmp_path):
    s = SettingsStore(db_path=str(tmp_path / "test.db"))
    await s.initialize()
    yield s
    await s.close()


@pytest.mark.asyncio
async def test_get_returns_defaults_on_fresh_db(store):
    assert await store.get() == {"layout_version": "v1", "theme_mode": "dark", "projects_root_path": None}


@pytest.mark.asyncio
async def test_partial_update_only_theme_mode_leaves_layout_version_untouched(store):
    updated = await store.update(theme_mode="light")
    assert updated == {"layout_version": "v1", "theme_mode": "light", "projects_root_path": None}

    # A read afterward reflects the same partial update, not just the
    # return value of update() itself.
    assert await store.get() == {"layout_version": "v1", "theme_mode": "light", "projects_root_path": None}


@pytest.mark.asyncio
async def test_partial_update_only_layout_version_leaves_theme_mode_untouched(store):
    updated = await store.update(layout_version="v2")
    assert updated == {"layout_version": "v2", "theme_mode": "dark", "projects_root_path": None}


@pytest.mark.asyncio
async def test_update_both_fields_at_once(store):
    updated = await store.update(layout_version="v2", theme_mode="light")
    assert updated == {"layout_version": "v2", "theme_mode": "light", "projects_root_path": None}


@pytest.mark.asyncio
async def test_persists_across_instances(tmp_path):
    """Mesmo padrão de test_agent_store.py::test_persists_across_instances:
    uma segunda instância de SettingsStore apontando pro mesmo arquivo de DB
    enxerga o valor gravado pela primeira, sem mockar aiosqlite."""
    db = str(tmp_path / "persist.db")
    s1 = SettingsStore(db_path=db)
    await s1.initialize()
    await s1.update(layout_version="v2", theme_mode="light")
    await s1.close()

    s2 = SettingsStore(db_path=db)
    await s2.initialize()
    result = await s2.get()
    await s2.close()
    assert result == {"layout_version": "v2", "theme_mode": "light", "projects_root_path": None}


@pytest.mark.asyncio
async def test_initialize_twice_does_not_reset_already_persisted_row(tmp_path):
    """INSERT OR IGNORE no initialize() não deve sobrescrever uma
    configuração já persistida por uma chamada anterior — cenário real:
    reload de módulo em teste, ou reinício do processo apontando pro mesmo
    sessions.db."""
    db = str(tmp_path / "reinit.db")
    s1 = SettingsStore(db_path=db)
    await s1.initialize()
    await s1.update(layout_version="v2", theme_mode="light")
    await s1.close()

    s2 = SettingsStore(db_path=db)
    await s2.initialize()  # segunda chamada de initialize() sobre o mesmo DB
    result = await s2.get()
    await s2.close()
    assert result == {"layout_version": "v2", "theme_mode": "light", "projects_root_path": None}


@pytest.mark.asyncio
async def test_update_projects_root_path_persists(store):
    updated = await store.update(projects_root_path="/mnt/d/projetos")
    assert updated == {"layout_version": "v1", "theme_mode": "dark", "projects_root_path": "/mnt/d/projetos"}
    assert await store.get() == {"layout_version": "v1", "theme_mode": "dark", "projects_root_path": "/mnt/d/projetos"}


@pytest.mark.asyncio
async def test_update_projects_root_path_does_not_touch_other_fields(store):
    await store.update(theme_mode="light")
    updated = await store.update(projects_root_path="/mnt/d/projetos")
    assert updated == {"layout_version": "v1", "theme_mode": "light", "projects_root_path": "/mnt/d/projetos"}


# -- Notification quiet-hours window ------------------------------------------


@pytest.mark.asyncio
async def test_get_notifications_returns_defaults_on_fresh_db(store):
    assert await store.get_notifications() == {
        "quiet_hours_enabled": False,
        "quiet_hours_start": "22:00",
        "quiet_hours_end": "07:00",
    }


@pytest.mark.asyncio
async def test_update_notifications_persists_all_three_fields(store):
    updated = await store.update_notifications(
        quiet_hours_enabled=True, quiet_hours_start="23:30", quiet_hours_end="06:00"
    )
    assert updated == {
        "quiet_hours_enabled": True,
        "quiet_hours_start": "23:30",
        "quiet_hours_end": "06:00",
    }
    assert await store.get_notifications() == updated


@pytest.mark.asyncio
async def test_disabling_quiet_hours_keeps_the_configured_range(store):
    """The reason `quiet_hours_enabled` is its own field: turning the window
    off can't erase the time the user configured, otherwise turning it back
    on would require typing everything again."""
    await store.update_notifications(
        quiet_hours_enabled=True, quiet_hours_start="23:30", quiet_hours_end="06:00"
    )
    updated = await store.update_notifications(quiet_hours_enabled=False)
    assert updated == {
        "quiet_hours_enabled": False,
        "quiet_hours_start": "23:30",
        "quiet_hours_end": "06:00",
    }


@pytest.mark.asyncio
async def test_update_notifications_does_not_touch_appearance_fields(store):
    await store.update(theme_mode="light")
    await store.update_notifications(quiet_hours_enabled=True)
    assert await store.get() == {
        "layout_version": "v1",
        "theme_mode": "light",
        "projects_root_path": None,
    }


@pytest.mark.asyncio
async def test_notification_settings_persist_across_instances(tmp_path):
    db = str(tmp_path / "notif-persist.db")
    s1 = SettingsStore(db_path=db)
    await s1.initialize()
    await s1.update_notifications(quiet_hours_enabled=True, quiet_hours_start="01:00")
    await s1.close()

    s2 = SettingsStore(db_path=db)
    await s2.initialize()
    result = await s2.get_notifications()
    await s2.close()
    assert result == {
        "quiet_hours_enabled": True,
        "quiet_hours_start": "01:00",
        "quiet_hours_end": "07:00",
    }
