// frontend/src/layouts/v2/NavTabs.jsx
// Navegação mobile dedicada do Layout v2 (plano do TL, Tarefa 6): extraído de
// SidebarV2.jsx (bloco `role="tablist"`), sem mudança de comportamento no
// variant default ('sidebar') — SidebarV2.jsx passa a importar este
// componente em vez de manter o bloco inline.
//
// Regra não negociável: retorna o `<div role="tablist">` como elemento de
// TOPO, sem nenhum wrapper — SidebarV2.test.jsx tem um teste
// (nav.parentElement === clientesLabel.parentElement) que só passa se nav
// continuar filho direto do mesmo `scrollArea` que o rótulo "Clientes"
// (ClienteList.jsx). Um <div> ou <> a mais aqui quebraria esse teste.
//
// `variant`:
//   - 'sidebar' (default): visual atual, vertical, usado por SidebarV2.jsx.
//   - 'segmented': usado só por MobileMenuScreen.jsx — segmented control
//     horizontal. Muda SÓ valores de `style`; a estrutura de DOM
//     (`div[role=tab]` com aria-selected/tabIndex/onClick/onKeyDown) é a
//     MESMA, então nenhum teste de clique/teclado existente quebra.

const sidebarStyles = {
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '4px 8px',
    flexShrink: 0,
  },
  navItem: (active, collapsed) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: collapsed ? '10px 0' : '10px 10px',
    justifyContent: collapsed ? 'center' : 'flex-start',
    borderRadius: '8px',
    cursor: 'pointer',
    minHeight: 'var(--touch-target, 44px)',
    background: active ? 'var(--v2-accent-soft)' : 'transparent',
    color: active ? 'var(--v2-accent-strong)' : 'var(--v2-text-dim)',
    fontSize: '13px',
    fontWeight: active ? 600 : 500,
  }),
  navIcon: {
    fontSize: '16px',
    lineHeight: 1,
    flexShrink: 0,
  },
  navLabel: {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
};

// Segmented control horizontal (MobileMenuScreen.jsx): 4 itens de largura
// igual (flex:1), altura 48-52px, item ativo com fundo --v2-accent-soft +
// texto --v2-accent-strong + barra inferior de 2-3px --v2-accent.
const segmentedStyles = {
  nav: {
    display: 'flex',
    flexDirection: 'row',
    gap: '4px',
    padding: '6px 12px',
    flexShrink: 0,
  },
  navItem: (active) => ({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '3px',
    padding: '6px 4px',
    minHeight: '50px',
    borderRadius: '10px',
    cursor: 'pointer',
    background: active ? 'var(--v2-accent-soft)' : 'transparent',
    color: active ? 'var(--v2-accent-strong)' : 'var(--v2-text-dim)',
    fontSize: '11px',
    fontWeight: active ? 600 : 500,
    borderBottom: active ? '3px solid var(--v2-accent)' : '3px solid transparent',
  }),
  navIcon: {
    fontSize: '18px',
    lineHeight: 1,
  },
  navLabel: {
    whiteSpace: 'nowrap',
  },
};

export function NavTabs({ navItems = [], activeScreen, onSelectScreen, collapsed = false, variant = 'sidebar' }) {
  const segmented = variant === 'segmented';
  const styles = segmented ? segmentedStyles : sidebarStyles;

  return (
    <div style={styles.nav} role="tablist" aria-label="Navegação">
      {navItems.map((item) => {
        const active = activeScreen === item.id;
        return (
          <div
            key={item.id}
            role="tab"
            tabIndex={0}
            aria-selected={active}
            style={segmented ? styles.navItem(active) : styles.navItem(active, collapsed)}
            onClick={() => onSelectScreen(item.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectScreen(item.id); }}
            title={item.label}
          >
            <span style={styles.navIcon}>{item.icon}</span>
            {(segmented || !collapsed) && <span style={styles.navLabel}>{item.label}</span>}
          </div>
        );
      })}
    </div>
  );
}
