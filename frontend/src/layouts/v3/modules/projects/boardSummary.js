// Read-only "Board · resumo": how many top-level cards sit in each column, in
// the scope of the workspace filter. Pure, no React.
import { resolveKey, scopeOf } from './registryIndex.js'

/**
 * @returns {{ columns: { slug: string, label: string, count: number }[], other: number, total: number } | null}
 *   null when the board has no columns (told apart from an empty board).
 */
export function buildBoardSummary({ cards, columns, registry, workspaceKey = '' }) {
  if (!Array.isArray(columns) || columns.length === 0) return null

  const ordered = columns.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const counts = new Map(ordered.map((column) => [column.slug, 0]))
  let other = 0
  let total = 0

  for (const card of cards || []) {
    // Subcards never count: only cards of the board top level.
    if (card.parent_id != null) continue
    const scope = scopeOf(resolveKey(card.projeto_id, registry))
    if (workspaceKey !== '' && scope !== workspaceKey) continue
    total += 1
    if (counts.has(card.status)) counts.set(card.status, counts.get(card.status) + 1)
    else other += 1
  }

  return {
    columns: ordered.map((column) => ({ slug: column.slug, label: column.label, count: counts.get(column.slug) })),
    other,
    total,
  }
}
