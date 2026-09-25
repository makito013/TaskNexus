"""Unit tests for the pure slug helpers (app/board_columns.py).

Everything that touches the board_columns TABLE lives in test_card_store.py —
this file only covers the string transformation, which has no I/O.
"""

import pytest
from app.board_columns import normalize_column_label, slugify_column_label

LEGACY_SLUGS = {"a_fazer", "em_andamento", "em_revisao", "feito"}


@pytest.mark.parametrize(
    "label,expected",
    [
        ("Em Homologação", "em_homologacao"),
        ("A Fazer", "a_fazer"),
        ("BLOQUEADO", "bloqueado"),
        ("  Aguardando   Cliente  ", "aguardando_cliente"),
        ("Pronto p/ Deploy!", "pronto_p_deploy"),
        ("Revisão — Técnica", "revisao_tecnica"),
        ("Sprint 2026", "sprint_2026"),
        ("___underscores___", "underscores"),
        ("çãõáéíóúâêô", "caoaeiouaeo"),
    ],
)
def test_slugify_normalizes_accents_case_and_punctuation(label, expected):
    assert slugify_column_label(label, set()) == expected


@pytest.mark.parametrize("label", ["", "   ", "!!!", "🚀🚀", "---"])
def test_slugify_falls_back_when_nothing_survives(label):
    assert slugify_column_label(label, set()) == "column"


def test_slugify_appends_a_suffix_on_collision_with_a_legacy_slug():
    # "A Fazer" would produce the legacy slug verbatim — it must not silently
    # adopt the legacy column's cards.
    assert slugify_column_label("A Fazer", LEGACY_SLUGS) == "a_fazer_2"


def test_slugify_walks_the_suffix_chain_until_it_finds_a_free_slug():
    taken = {"revisao", "revisao_2", "revisao_3"}
    assert slugify_column_label("Revisão", taken) == "revisao_4"


def test_slugify_fallback_also_respects_collisions():
    assert slugify_column_label("🚀", {"column"}) == "column_2"


def test_slugify_is_deterministic_for_the_same_inputs():
    first = slugify_column_label("Em Homologação", LEGACY_SLUGS)
    second = slugify_column_label("Em Homologação", LEGACY_SLUGS)
    assert first == second == "em_homologacao"


@pytest.mark.parametrize(
    "left,right",
    [
        ("Em Homologação", "  em   HOMOLOGAÇÃO "),
        ("A Fazer", "a fazer"),
        ("Feito", "FEITO"),
    ],
)
def test_normalize_label_treats_case_and_spacing_as_the_same_label(left, right):
    assert normalize_column_label(left) == normalize_column_label(right)


def test_normalize_label_keeps_accents_distinct():
    # Unlike the slug, the label comparison does NOT strip accents: "Revisao"
    # and "Revisão" are two different names a user may legitimately want.
    assert normalize_column_label("Revisão") != normalize_column_label("Revisao")
