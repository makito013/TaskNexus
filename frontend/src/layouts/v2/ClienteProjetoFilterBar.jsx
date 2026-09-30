// frontend/src/layouts/v2/ClienteProjetoFilterBar.jsx
// Cliente/Projeto filter cascade UI for the v2 screens, driven entirely by
// `useClienteProjetoFilter` (this component holds no state of its own).
//
// Native <select>s styled inline with the same tokens BoardV2's "move card"
// select already uses — no new visual language introduced here.
//
// Two shapes, one component:
// - sidebar on "Todos": both selects are always present (pick the client
//   here, then the project). The project select stays disabled, offering only
//   "Todos os projetos", until a client is picked — there is no project list
//   to offer before that, but the control must still be visible so the two
//   selects read as one cascade from the moment the board opens.
// - sidebar on a specific client: project select only, the client is fixed.
//   Here it is hidden when that client has no direct children, since
//   "Todos os projetos" would be its only option and nothing can change that.
//
// Fase N: with a project chosen on the sidebar, the project select comes
// pre-filled with it and also lists its subprojects (the option list is built
// by useClienteProjetoFilter). Options deeper than a direct child read as the
// path below the client ("api-pagamentos / v2") so siblings with the same
// folder name stay distinguishable, and the client itself reads "Raiz".

import { resolveClienteNome } from '../../utils/taskGroups.js';
import { relativeProjectPath } from '../../utils/projects.js';
import { labelFor } from '../../utils/projectTree.js';

// Text of a project <option>. Falls back to the folder name for a project the
// list does not know yet, like every other <option> label in the app
// (resolveProjectLabel, utils/projects.js) — an empty option would read as a
// broken select.
function projetoOptionLabel(projetoId, clienteId, projects) {
  if (projetoId === clienteId) return 'Raiz';
  const depth = projetoId.split('/').length - clienteId.split('/').length;
  if (depth >= 2) return relativeProjectPath(projetoId, clienteId);
  return labelFor(projetoId, projects);
}

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 16px',
    borderBottom: '1px solid var(--v2-border)',
    flexShrink: 0,
    flexWrap: 'wrap',
  },
  // The inline color/background would otherwise override the UA's greying of
  // a disabled control, so the disabled state carries its own dimming.
  select: (disabled) => ({
    fontSize: '12px',
    color: 'var(--v2-text-dim)',
    background: 'var(--v2-surface-3)',
    border: '1px solid var(--v2-border)',
    borderRadius: '6px',
    padding: '5px 6px',
    maxWidth: '220px',
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }),
};

export function ClienteProjetoFilterBar({
  clienteSelectEnabled,
  clientes = [],
  localClienteId,
  onSelectLocalCliente,
  effectiveClienteId,
  subProjetoIds = [],
  selectedProjetoId,
  onSelectProjeto,
  projects = [],
}) {
  // In "Todos" mode the project select is always part of the bar, even before
  // a client is picked. Outside it, the sidebar already fixed the client, so
  // the select only earns its place when that client has children to offer.
  const showProjetoSelect = clienteSelectEnabled || (effectiveClienteId != null && subProjetoIds.length > 0);
  if (!clienteSelectEnabled && !showProjetoSelect) return null;

  // Native select values are always strings — "" is the "no filter" option and
  // is normalized back to null so downstream `== null` checks stay correct.
  const toFilterValue = (value) => (value === '' ? null : value);

  return (
    <div style={styles.bar} data-testid="cliente-projeto-filter-bar">
      {clienteSelectEnabled && (
        <select
          style={styles.select(false)}
          aria-label="Filtrar por cliente"
          value={localClienteId ?? ''}
          onChange={(e) => onSelectLocalCliente(toFilterValue(e.target.value))}
        >
          <option value="">Todos os clientes</option>
          {clientes.map((cliente) => (
            <option key={cliente.id} value={cliente.id}>
              {resolveClienteNome(cliente.id, projects)}
            </option>
          ))}
        </select>
      )}

      {showProjetoSelect && (
        <select
          style={styles.select(effectiveClienteId == null)}
          aria-label="Filtrar por projeto"
          disabled={effectiveClienteId == null}
          value={selectedProjetoId ?? ''}
          onChange={(e) => onSelectProjeto(toFilterValue(e.target.value))}
        >
          <option value="">Todos os projetos</option>
          {subProjetoIds.map((projetoId) => (
            <option key={projetoId} value={projetoId}>
              {projetoOptionLabel(projetoId, effectiveClienteId, projects)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
