// frontend/src/layouts/v2/MobileMenuScreen.jsx
// Navegação mobile dedicada do Layout v2 (plano do TL, Tarefa 11): tela cheia
// inicial do fluxo mobile (`mobileView === 'menu'` em AppV2.jsx) — header fixo
// (marca, sem botão de colapsar — não existe conceito de "colapsar" no
// mobile) + NavTabs (variant="segmented", 4 abas) + divider + label
// "Clientes" + ClienteList (variant="mobile", linhas mais altas) rolável +
// footer fixo com AppearanceSwitch.
//
// Renderiza por cima do conteúdo (`content`, que fica sempre montado por
// baixo — AppV2.jsx) como um overlay `position:fixed; inset:0`.

import { AppearanceSwitch } from '../../components/AppearanceSwitch.jsx';
import { NavTabs } from './NavTabs.jsx';
import { ClienteList } from './ClienteList.jsx';

const styles = {
  screen: {
    position: 'fixed',
    inset: 0,
    zIndex: 45,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--v2-bg)',
    color: 'var(--v2-text)',
  },
  header: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    paddingTop: 'calc(env(safe-area-inset-top) + 12px)',
    borderBottom: '1px solid var(--v2-border)',
    background: 'var(--v2-surface)',
  },
  brand: {
    fontSize: '15px',
    fontWeight: 700,
    color: 'var(--v2-text)',
  },
  scrollArea: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },
  footer: {
    flexShrink: 0,
    paddingBottom: 'env(safe-area-inset-bottom)',
    background: 'var(--v2-surface)',
    borderTop: '1px solid var(--v2-border)',
  },
};

export function MobileMenuScreen({
  navItems = [],
  activeScreen,
  onSelectScreen,
  clientes = [],
  selectedClienteId,
  onSelectCliente,
  initialAppearance,
}) {
  return (
    <div style={styles.screen} className="v2-mobile-menu-enter" data-testid="mobile-menu-screen">
      <div style={styles.header}>
        <span style={styles.brand}>TaskNexus</span>
      </div>

      <div style={styles.scrollArea}>
        <NavTabs
          variant="segmented"
          navItems={navItems}
          activeScreen={activeScreen}
          onSelectScreen={onSelectScreen}
        />
        <ClienteList
          variant="mobile"
          clientes={clientes}
          selectedClienteId={selectedClienteId}
          onSelectCliente={onSelectCliente}
        />
      </div>

      <div style={styles.footer}>
        <AppearanceSwitch initialAppearance={initialAppearance} />
      </div>
    </div>
  );
}
