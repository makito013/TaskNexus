// frontend/src/layouts/v2/SidebarV2.jsx
// Milestone 2 (plano Layout v2, 05-TL.md, Tarefa 13): navegação lateral do
// casco v2 — recolhível (240px<->68px, transição de largura 0.18s),
// nav de 4 telas (só Chat funcional neste milestone — ver AppV2.jsx) + lista
// de clientes/projetos (reaproveita useProjects() via prop `projects`, já
// buscada por AppV2) + rodapé fixo (margin-top:auto) com o AppearanceSwitch
// NO LUGAR do "Você, projeto pessoal" do mock original — instrução literal
// do Bruno (Tarefa 13).
//
// Etapa 7 (plano de fix, RF01): nav + divider + "Clientes" + lista de
// clientes viram UM wrapper único com overflowY:auto (styles.scrollArea) —
// antes só `projectList` rolava, então nav/divider/label ficavam fora da
// área de rolagem e "somiam" de vista ao rolar a lista de clientes pra baixo
// num viewport curto (iPad em paisagem com muitos clientes). Só `header`
// (marca + botão de toggle) e `footer` (AppearanceSwitch) continuam FORA do
// scroll, como já eram.
//
// Navegação mobile dedicada do Layout v2 (plano do TL, Tarefa 8): nav
// (role=tablist) e a seção "Todos"+clientes.map foram extraídos para
// NavTabs.jsx/ClienteList.jsx (reaproveitados pelo menu mobile via
// MobileMenuScreen.jsx) — nenhuma mudança de comportamento aqui, só troca de
// onde o JSX vive fisicamente.

import { AppearanceSwitch } from '../../components/AppearanceSwitch.jsx';
import { NavTabs } from './NavTabs.jsx';
import { ClienteList } from './ClienteList.jsx';
import { EXPANDED_WIDTH, COLLAPSED_WIDTH, SIDEBAR_TRANSITION } from './collapseLayout.js';

const styles = {
  sidebar: (collapsed) => ({
    width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
    minWidth: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
    background: 'var(--v2-surface)',
    borderRight: '1px solid var(--v2-border)',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    transition: SIDEBAR_TRANSITION,
  }),
  header: (collapsed) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'space-between',
    padding: collapsed ? '14px 8px' : '16px 16px 12px',
    flexShrink: 0,
  }),
  brand: {
    fontSize: '13px',
    fontWeight: 700,
    color: 'var(--v2-text)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  toggleBtn: {
    width: 'var(--touch-target, 44px)',
    height: 'var(--touch-target, 44px)',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: '1px solid var(--v2-border)',
    borderRadius: '8px',
    color: 'var(--v2-text-dim)',
    cursor: 'pointer',
    fontSize: '14px',
  },
  // RF01: wrapper único que rola nav + divider + "Clientes" + lista de
  // clientes juntos — `projectList` (abaixo) não rola mais sozinho.
  scrollArea: {
    flex: 1,
    overflowY: 'auto',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  footer: {
    marginTop: 'auto',
    flexShrink: 0,
  },
};

export function SidebarV2({
  collapsed,
  onToggleCollapsed,
  clientes = [],
  selectedClienteId,
  onSelectCliente,
  navItems = [],
  activeScreen,
  onSelectScreen,
  initialAppearance,
}) {
  return (
    <div style={styles.sidebar(collapsed)}>
      <div style={styles.header(collapsed)}>
        {!collapsed && <span style={styles.brand}>TaskNexus</span>}
        <button
          type="button"
          style={styles.toggleBtn}
          onClick={onToggleCollapsed}
          title={collapsed ? 'Mostrar barra lateral' : 'Esconder barra lateral'}
          aria-label={collapsed ? 'Mostrar barra lateral' : 'Esconder barra lateral'}
        >
          {collapsed ? '☰' : '‹'}
        </button>
      </div>

      {/* RF01: nav + divider + "Clientes" + lista de clientes rolam juntos
          como uma única área — antes só a lista de clientes (`projectList`)
          rolava, deixando nav/divider/label fora da vista ao rolar até o
          fim de uma lista longa de clientes. */}
      <div style={styles.scrollArea}>
        <NavTabs
          navItems={navItems}
          activeScreen={activeScreen}
          onSelectScreen={onSelectScreen}
          collapsed={collapsed}
        />

        <ClienteList
          clientes={clientes}
          selectedClienteId={selectedClienteId}
          onSelectCliente={onSelectCliente}
          collapsed={collapsed}
        />
      </div>

      {!collapsed && (
        <div style={styles.footer}>
          <AppearanceSwitch initialAppearance={initialAppearance} />
        </div>
      )}
    </div>
  );
}
