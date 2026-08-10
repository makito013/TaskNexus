// frontend/src/components/StartChatCTA.jsx
// Disconnected-state panel shown when a project is selected but has no started
// chat session yet. One button per agent configured for the project (Claude,
// Gemini, ...) — "Iniciar chat {agente}" is the ONLY path that spawns a new
// PTY process for that agent (D-07).

const statusLabel = {
  running: { text: 'Rodando em outro dispositivo', color: 'var(--state-running)' },
  idle: { text: 'Sessão ativa no servidor', color: 'var(--accent-green)' },
  disconnected: { text: 'Processo existe mas sem conexão', color: 'var(--text-muted)' },
}

// Same accent pairing as the .badge--* classes in index.css, but applied
// directly (not via .badge) since .badge also carries uppercase/letter-spacing
// meant for small tags, not a full-size CTA button.
const agentAccent = {
  claude: { bg: 'var(--accent-claude-bg)', text: 'var(--accent-claude-text)' },
  gemini: { bg: 'var(--accent-gemini-bg)', text: 'var(--accent-gemini-text)' },
  anti: { bg: 'var(--accent-anti-bg)', text: 'var(--accent-anti-text)' },
}
const defaultAccent = { bg: 'var(--accent-green)', text: '#000' }

function AgentStartButton({ agent, status, onStart }) {
  const info = statusLabel[status]
  const accent = agentAccent[agent.ia] || defaultAccent
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
      {info && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: info.color }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: info.color, flexShrink: 0 }} />
          {info.text}
        </div>
      )}
      <button
        onClick={() => onStart(agent.id)}
        style={{
          padding: '12px 28px',
          fontSize: '14px',
          fontWeight: 600,
          background: accent.bg,
          color: accent.text,
          border: 'none',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          transition: 'opacity 0.15s',
          minWidth: '200px',
          minHeight: 'var(--touch-target)',
        }}
        onMouseOver={(e) => e.currentTarget.style.opacity = '0.85'}
        onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
      >
        Iniciar chat {agent.nome}
      </button>
    </div>
  )
}

export function StartChatCTA({ project, activeSessions, onStartAgent }) {
  const agentes = project?.agentes || []

  return (
    <div style={{
      margin: 'auto',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '16px',
      padding: '40px 24px',
      textAlign: 'center',
      maxWidth: '360px',
    }}>
      <div style={{ fontSize: '40px', lineHeight: 1 }}>🤖</div>

      <div>
        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
          {project?.nome || project?.id}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{project?.id}</div>
      </div>

      {agentes.length === 0 ? (
        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Nenhum agente configurado para este projeto.
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '20px' }}>
          {agentes.map((agent) => (
            <AgentStartButton
              key={agent.id}
              agent={agent}
              status={activeSessions?.[`${project.id}::${agent.id}`]?.status}
              onStart={onStartAgent}
            />
          ))}
        </div>
      )}

      <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0, maxWidth: '260px' }}>
        Isso abrirá um terminal com o contexto deste agente injetado automaticamente.
      </p>
    </div>
  )
}
