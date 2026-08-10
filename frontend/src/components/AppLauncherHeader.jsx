// frontend/src/components/AppLauncherHeader.jsx
// Faixa fina e persistente no topo do viewport — substitui o AppLauncher
// (botão flutuante position:fixed, proposta original de 05-DESIGNER.md
// seções 2.1/2.2). Resolve o requisito de v1 pedido pelo Bruno (seção 2.5):
// um product switcher estilo Confluence/Jira, integrado à própria topbar, não
// um botão solto por cima do conteúdo. Ver Tarefa 16 de 05-TL.md.
//
// Este componente reserva espaço vertical real — é uma "linha" normal do
// fluxo do documento (não position:fixed) dentro do container flex-column que
// App.jsx vai montar na Tarefa 17. O dropdown de troca de sistema é ANCORADO
// (position:absolute relativo a este header, que por isso é position:relative),
// não um overlay fullscreen.

import { useEffect, useRef, useState } from 'react';
import { getSystemByRoute } from '../config/systems.js';
import { SystemIcon, SystemSwitcherDropdown } from './SystemSwitcherDropdown.jsx';
import logoUrl from '../assets/logo.svg';

export { SystemIcon };

const styles = {
  header: {
    position: 'relative', // âncora do dropdown — este header nunca usa position:fixed
    zIndex: 900, // abaixo dos modais fullscreen (1000+) e do próprio dropdown (950), acima do conteúdo normal
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    height: 'var(--touch-target)',
    minHeight: 'var(--touch-target)',
    padding: '0 8px',
    // Mais opaco/escuro que os headers internos de modal/drawer (--bg-surface-2,
    // usados em TasksDrawer/AgentSettingsModal) para ler como "faixa de
    // sistema" persistente e não como mais um header de tela — mesmo
    // princípio da faixa superior escura do Confluence/Jira, sem cor nova.
    background: 'var(--bg-surface-3)',
    borderBottom: '1px solid var(--border-strong)',
    flexShrink: 0,
  },
  logo: {
    // Dimensão intrínseca explícita nas duas direções: o SVG de origem
    // declara width/height="100%" (sem proporção intrínseca própria) — com
    // só `height` fixo e `width: auto`, Safari (inclusive iPad, cliente
    // remoto declarado deste app) historicamente falha em inferir a
    // proporção de um <img> assim, colapsando ou distorcendo o SVG.
    height: '26px',
    width: `${(26 * 500) / 150}px`, // mesma razão 500:150 do viewBox de logo.svg
    flexShrink: 0,
  },
  trigger: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    minHeight: '32px',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
    color: 'var(--text-primary)',
    cursor: 'pointer',
  },
  name: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  chevron: (open) => ({
    fontSize: '10px',
    color: 'var(--text-secondary)',
    transition: 'transform 0.15s ease',
    transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
  }),
};

export function AppLauncherHeader({ currentPath, onNavigate }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const current = getSystemByRoute(currentPath) || null;

  // Fecha ao clicar fora: listener de `mousedown` no document (em vez de
  // `onBlur` no container) porque o dropdown é renderizado como descendente
  // deste mesmo container (position:absolute dentro do position:relative do
  // header) — onBlur exigiria checar `relatedTarget` a cada troca de foco
  // entre o trigger e os itens do dropdown, mais frágil do que simplesmente
  // checar se o clique real caiu fora do container via `contains()`.
  useEffect(() => {
    if (!open) return undefined;

    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div style={styles.header} ref={containerRef}>
      {/* Marca do produto (TaskNexus) — distinta do trigger abaixo, que mostra
          o nome da TELA atual (Escritório/Board/Tarefas, ver systems.js).
          Fica fora do <button> do trigger: não é clicável, não abre o
          dropdown, é só identidade visual persistente da faixa. */}
      <img src={logoUrl} alt="TaskNexus" style={styles.logo} />
      <button
        type="button"
        style={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {current && <SystemIcon icone={current.icone} />}
        <span style={styles.name}>{current ? current.nome : 'TaskNexus'}</span>
        <span style={styles.chevron(open)}>▾</span>
      </button>

      {open && (
        <SystemSwitcherDropdown
          currentPath={currentPath}
          onNavigate={onNavigate}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
