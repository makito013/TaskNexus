// frontend/src/layouts/v2/ClienteList.jsx
// Navegação mobile dedicada do Layout v2 (plano do TL, Tarefa 7): extraído de
// SidebarV2.jsx (bloco "Todos" + `clientes.map`), sem mudança de
// comportamento no variant default ('sidebar').
//
// Regra não negociável: retorna um Fragment (divider + label + lista), NÃO
// um <div> — precisa continuar filho direto do `scrollArea` de quem o usa
// (SidebarV2.jsx hoje) para o teste de rolagem conjunta continuar válido
// (nav.parentElement === clientesLabel.parentElement em SidebarV2.test.jsx).
//
// `variant` (mesmo padrão de NavTabs.jsx, não fazia parte da extração 1:1 do
// plano original, mas é necessário pra Tarefa 11/MobileMenuScreen — "linhas
// 52-56px de altura, mais respiro que os 44px do desktop"): muda só valores
// de `style` (altura de linha), a estrutura de DOM é idêntica.
//   - 'sidebar' (default): visual atual, linhas de 44px (--touch-target).
//   - 'mobile': linhas mais altas (54px), usado só por MobileMenuScreen.jsx.
//
// `collapsed` (retrabalho pontual, pedido literal do Bruno: "deveria ao
// esconder ficar os icones avatar" + confirmação "do cliente, deveria ficar o
// avatar do cliente tb"): default `false` — SÓ SidebarV2.jsx (desktop) passa
// esta prop; MobileMenuScreen.jsx usa este componente sem passá-la, então seu
// visual não muda em nada. Quando `true`: divider + rótulo "Clientes" somem,
// e cada item (inclusive "Todos") passa a renderizar um avatar circular
// (.v2-cliente-avatar) em vez do nome por extenso — mesmo onClick/title de
// antes, só o conteúdo interno do item muda. "Todos" usa o glyph "✱" (não
// iniciais "T" — colidiria visualmente com um cliente real cujo nome comece
// com T; achado do QA: "▦" também colidiria com o ícone de nav do Board,
// que já usa esse mesmo glyph em AppV2.jsx).

import { Fragment } from 'react';

const baseStyles = {
  divider: {
    height: '1px',
    background: 'var(--v2-border)',
    margin: '8px 12px',
    flexShrink: 0,
  },
  sectionLabel: {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--v2-text-faint)',
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    padding: '4px 12px 6px',
    flexShrink: 0,
  },
  projectList: {
    padding: '0 8px',
  },
};

function projectItemStyle(active, minHeight, collapsed) {
  return {
    padding: collapsed ? '4px 0' : '8px 10px',
    borderRadius: '8px',
    cursor: 'pointer',
    marginBottom: '2px',
    minHeight,
    display: 'flex',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'flex-start',
    background: active ? 'var(--v2-surface-2)' : 'transparent',
    color: active ? 'var(--v2-text)' : 'var(--v2-text-dim)',
    fontSize: '13px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
}

// Mesmo padrão de `initialsFor` em ChatList.jsx — duplicado de propósito (2
// linhas, não vale um módulo compartilhado só por isso, decisão já tomada
// pelo Bruno pra esta rodada).
function initialsFor(name) {
  return (name || '?').trim().slice(0, 1).toUpperCase();
}

export function ClienteList({
  clientes = [],
  selectedClienteId,
  onSelectCliente,
  variant = 'sidebar',
  collapsed = false,
}) {
  const minHeight = variant === 'mobile' ? '54px' : 'var(--touch-target, 44px)';

  return (
    <Fragment>
      {!collapsed && <div style={baseStyles.divider} />}
      {!collapsed && <div style={baseStyles.sectionLabel}>Clientes</div>}
      <div style={baseStyles.projectList}>
        <div
          style={projectItemStyle(selectedClienteId == null, minHeight, collapsed)}
          onClick={() => onSelectCliente(null)}
          title="Todos"
        >
          {collapsed ? <span className="v2-cliente-avatar">✱</span> : 'Todos'}
        </div>
        {clientes.map((p) => (
          <div
            key={p.id}
            style={projectItemStyle(p.id === selectedClienteId, minHeight, collapsed)}
            onClick={() => onSelectCliente(p.id)}
            title={p.nome}
          >
            {collapsed ? <span className="v2-cliente-avatar">{initialsFor(p.nome)}</span> : p.nome}
          </div>
        ))}
      </div>
    </Fragment>
  );
}
