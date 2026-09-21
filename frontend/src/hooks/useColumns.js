// frontend/src/hooks/useColumns.js
// Board column state (task #43, phase 1). Companion to useCards.js: that hook
// owns the CARDS, this one owns the COLUMNS they sit in.
//
// Key design decisions:
//
// - NO poll, unlike useCards. Columns only change when Bruno changes them,
//   from this very screen — there is no agent path that creates or renames a
//   column (MCP tools only move a card between columns that already exist).
//   A 5s poll would spend a request every 5 seconds to re-read data that only
//   this tab can write.
//
// - Every mutation applies the SERVER's answer to local state, never a
//   hand-built optimistic guess. `reorderColumns` and `setDoneColumn` return
//   the whole board (two rows change at once in the done case), and
//   `createColumn` returns the slug the backend derived from the label — a
//   value the frontend cannot compute on its own (accent stripping, collision
//   suffixes) without duplicating the slug rules in JS.
//
// - Mutation errors are RE-THROWN, never swallowed and never `alert()`ed here.
//   Each caller already has a surface for them: the rename dialog shows the
//   message inline and stays open, the ghost-column create input
//   reverts, and the delete dialog needs the `reason` field to choose which of
//   its three variants to show.
//
// - `doneSlug` is `null` until the first fetch resolves. Consumers treat that
//   as "don't recompute anything that depends on done-ness yet" rather than
//   gating on `loading` a second time — see isPrazoAtrasado's contract.

import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api.js';

export function useColumns() {
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.fetchBoardColumns()
      .then((list) => { if (!cancelled) setColumns(list); })
      .catch((e) => {
        // Tolerant read, same as useCards.fetchCards: keep whatever is on
        // screen instead of alert()ing. An empty column list renders as an
        // empty board, which is honest about the failure.
        console.warn('fetchBoardColumns error (keeping last known state)', e);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const createColumn = useCallback(async (label) => {
    const created = await api.createBoardColumn(label);
    setColumns((prev) => [...prev, created]);
    return created;
  }, []);

  const renameColumn = useCallback(async (slug, label) => {
    const updated = await api.updateBoardColumn(slug, label);
    setColumns((prev) => prev.map((c) => (c.slug === slug ? updated : c)));
    return updated;
  }, []);

  // The ONLY optimistic mutation here, and phase 2's drag is why: a column has
  // to follow the finger immediately, so it cannot wait for a round-trip. The
  // arrows share the path and get the same snappiness for free.
  //
  // Optimism needs a rollback, so the pre-drag order is captured BEFORE the
  // local write and restored if the server refuses (a 409 when another tab has
  // since created or deleted a column, making this list no longer a
  // permutation). Rolling back to a snapshot rather than re-fetching is
  // deliberate for this phase: there is no automatic retry/refetch yet, and
  // silently swapping the user's board for a different one after a failed drag
  // would be a second surprise on top of the first.
  const reorderColumns = useCallback(async (slugs) => {
    const previous = columns;
    const bySlug = new Map(previous.map((c) => [c.slug, c]));
    const optimistic = slugs
      .map((slug, index) => {
        const column = bySlug.get(slug);
        return column ? { ...column, position: index + 1 } : null;
      })
      .filter(Boolean);
    setColumns(optimistic);

    try {
      // The server's answer still wins: it is the authority on `position`,
      // and it may carry a label another tab changed mid-drag.
      const next = await api.reorderBoardColumns(slugs);
      setColumns(next);
      return next;
    } catch (e) {
      setColumns(previous);
      throw e;
    }
  }, [columns]);

  const setDoneColumn = useCallback(async (slug) => {
    // Replaces the whole list on purpose: marking a column done also UNMARKS
    // the previous one, so a per-row patch would leave two rows claiming to
    // be the done column until the next full read.
    const next = await api.setDoneColumn(slug);
    setColumns(next);
    return next;
  }, []);

  const deleteColumn = useCallback(async (slug) => {
    await api.deleteBoardColumn(slug);
    setColumns((prev) => prev.filter((c) => c.slug !== slug));
  }, []);

  const doneColumn = columns.find((c) => c.is_done);

  return {
    columns,
    loading,
    doneSlug: doneColumn ? doneColumn.slug : null,
    firstSlug: columns.length ? columns[0].slug : null,
    createColumn,
    renameColumn,
    reorderColumns,
    setDoneColumn,
    deleteColumn,
  };
}
