// frontend/src/components/ProjectGroupHeader.jsx
//
// Cabeçalho de grupo compartilhado entre a visão Lista do Board e a tela
// Tarefas (TarefasGlobalView) — ver 05-TL.md Tarefa 14 e 05-DESIGNER.md
// seção 14.1 / item 5 da "Atualização de contexto sugerida". Estrutura
// visual espelha `.group-header` de 05-mockup.html (chev / name / count /
// rule): chevron de colapsar + nome do grupo + contagem + régua horizontal.
//
// Deliberadamente genérico: `count`/`countLabel` são props, nunca texto
// hardcoded ("N cards" no Board, "N pendentes" em Tarefas) — o componente só
// monta `${count} ${countLabel}`. `collapsed` é controlado de fora (sem
// useState interno); o clique em qualquer parte do cabeçalho (chevron, nome
// ou contagem) dispara `onToggle`.

const styles = {
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 6px',
    cursor: 'pointer',
  },
  chev: {
    color: 'var(--text-muted)',
    fontSize: '10px',
    width: '10px',
    flexShrink: 0,
  },
  name: {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  count: {
    fontSize: '10px',
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  rule: {
    flex: 1,
    height: '1px',
    background: 'var(--border)',
  },
}

export function ProjectGroupHeader({ label, count, countLabel, collapsed, onToggle }) {
  return (
    <div style={styles.header} onClick={onToggle}>
      <span style={styles.chev}>{collapsed ? '▸' : '▾'}</span>
      <span style={styles.name}>{label}</span>
      <span style={styles.count}>{count} {countLabel}</span>
      <span style={styles.rule} />
    </div>
  )
}
