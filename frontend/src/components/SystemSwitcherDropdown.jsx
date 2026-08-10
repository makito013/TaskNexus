// frontend/src/components/SystemSwitcherDropdown.jsx
// Dropdown ANCORADO (não modal fullscreen) que lista os 3 SYSTEMS. Aberto por
// AppLauncherHeader.jsx via position:absolute relativo ao container do
// próprio header — não um overlay `inset:0` como TaskDetailModal/
// AgentSettingsModal. Concretiza o requisito de v1 do Bruno (05-DESIGNER.md,
// seção 2.5): "mais parecido com o menu de troca de produto da Atlassian do
// que com os modais fullscreen já usados no resto do app". Ver Tarefa 16 de
// 05-TL.md.
//
// `SystemIcon` mora aqui (não em AppLauncherHeader.jsx) e é reexportado de lá
// para que os dois arquivos fiquem só um-caminho de import (Header -> este
// arquivo), sem import circular entre os dois componentes.

import { SYSTEMS } from '../config/systems.js';

const ICON_SIZE = 20;

// Ícones desenhados com os primitivos visuais que já existem no app — sem lib
// de ícones externa (05-DESIGNER.md, seção 2.3):
// - tarefas: mesmo vocabulário círculo+linha de TasksDrawer.jsx (styles.circle)
// - board: barras verticais, mesma metáfora das barras de cabeçalho de coluna do Board
// - escritorio: glifo de terminal na fonte mono do projeto
export function SystemIcon({ icone, size = ICON_SIZE }) {
  if (icone === 'tarefas') {
    const rows = [true, true, false]; // 2 preenchidas + 1 vazia, mesma proporção usada em TasksDrawer
    return (
      <div
        style={{
          width: size,
          height: size,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '2px 0',
          boxSizing: 'border-box',
        }}
      >
        {rows.map((done, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            <span
              style={{
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                flexShrink: 0,
                background: done ? 'var(--accent-green)' : 'transparent',
                border: done ? 'none' : '1px solid var(--border-strong)',
                boxSizing: 'border-box',
              }}
            />
            <span style={{ width: '10px', height: '2px', borderRadius: '1px', background: 'var(--border-strong)' }} />
          </div>
        ))}
      </div>
    );
  }

  if (icone === 'board') {
    return (
      <div style={{ width: size, height: size, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '3px' }}>
        <span style={{ width: '2px', height: '40%', borderRadius: '2px 2px 0 0', background: 'var(--border-strong)' }} />
        <span style={{ width: '2px', height: '70%', borderRadius: '2px 2px 0 0', background: 'var(--accent-claude)' }} />
        <span style={{ width: '2px', height: '100%', borderRadius: '2px 2px 0 0', background: 'var(--accent-green)' }} />
      </div>
    );
  }

  // 'escritorio' (e fallback): glifo de terminal, zero ativo novo.
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize: `${Math.round(size * 0.55)}px`,
        color: 'var(--accent-claude)',
        lineHeight: 1,
      }}
    >
      &gt;_
    </div>
  );
}

const styles = {
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: '8px',
    zIndex: 950, // abaixo dos modais fullscreen (1000+, TaskDetailModal/AgentSettingsModal), acima do conteúdo normal
    minWidth: '220px',
    background: 'var(--bg-surface-2)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-md)',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
    overflow: 'hidden',
    padding: '4px 0',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    minHeight: 'var(--touch-target)',
    padding: '0 12px',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-primary)',
    fontSize: '13px',
    textAlign: 'left',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  itemActive: {
    background: 'var(--bg-active)',
  },
  name: {
    flex: 1,
  },
  trailing: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    flexShrink: 0,
  },
  trailingActive: {
    color: 'var(--accent-green)',
    fontWeight: 700,
  },
};

export function SystemSwitcherDropdown({ currentPath, onNavigate, onClose }) {
  return (
    <div style={styles.dropdown} role="menu">
      {SYSTEMS.map((system) => {
        const active = system.rota === currentPath;
        return (
          <button
            key={system.id}
            type="button"
            role="menuitem"
            style={{ ...styles.item, ...(active ? styles.itemActive : {}) }}
            onClick={() => {
              onNavigate(system.rota);
              onClose();
            }}
          >
            <SystemIcon icone={system.icone} />
            <span style={styles.name}>{system.nome}</span>
            <span style={{ ...styles.trailing, ...(active ? styles.trailingActive : {}) }}>
              {active ? '✓' : '›'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
