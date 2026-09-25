// frontend/src/components/AgentForm.jsx
// Formulário de agente global (id, nome, papel, ia, comando, env) — extraído
// de components/AgentSettingsModal.jsx, o modal de agentes do layout v1 —
// extraído para cá enquanto os dois coexistiam, e único sobrevivente depois
// que aquele modal foi aposentado. Hoje tem um ponto de montagem só: a tela
// "Configuração" do layout v2 (layouts/v2/ConfiguracaoV2.jsx), que reúne o
// CRUD completo de agentes. Continua em components/ (não em layouts/v2/)
// por não depender de nada do contexto do v2.
//
// `onSubmit(payload)` é sempre um wrapper do caller que decide entre
// createAgent(payload) e updateAgent(id, payload) — as duas funções do hook
// useAgentSettings têm ARIDADE DIFERENTE, então nenhuma delas pode ser
// passada direta como `onSubmit`.
//
// Atenção: os campos usam ids de DOM fixos (`agent-id`, `agent-nome`, …), o
// que só é válido com UM formulário montado por vez na página — o caller
// segue esse contrato (um único `formTarget` por tela, nunca um formulário
// por card/linha).

import { useState } from 'react';

const styles = {
  formField: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    marginBottom: '6px',
    fontSize: '12px',
    color: 'var(--text-secondary)',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    minHeight: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg-surface-2)',
    color: 'var(--text-primary)',
    fontSize: '14px',
  },
  inputDisabled: {
    opacity: 0.6,
  },
  select: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    minHeight: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg-surface-2)',
    color: 'var(--text-primary)',
    fontSize: '14px',
  },
  hint: {
    marginTop: '4px',
    fontSize: '11px',
    color: 'var(--text-muted)',
  },
  errorText: {
    marginBottom: '12px',
    fontSize: '12px',
    color: 'var(--state-attention)',
  },
  formFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '8px',
  },
  cancelBtn: {
    padding: '10px 18px',
    minHeight: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-strong)',
    background: 'transparent',
    color: 'var(--text-primary)',
    fontSize: '14px',
    cursor: 'pointer',
  },
  submitBtn: {
    padding: '10px 18px',
    minHeight: 'var(--touch-target)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--accent-green)',
    background: 'var(--accent-green-dim)',
    color: 'var(--accent-green)',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};

function splitCmd(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

// Formulário aceita "KEY=VALUE" uma por linha (mais legível que JSON pra um
// usuário final) — convertido pro dict {chave: valor} que o backend espera
// (Agent.env, ver models.py). Linhas sem "=" ou vazias são ignoradas.
function parseEnvText(text) {
  const env = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

function envToText(env) {
  return Object.entries(env || {}).map(([k, v]) => `${k}=${v}`).join('\n');
}

export function AgentForm({ agent, onCancel, onSaved, onSubmit }) {
  const isEdit = !!agent;
  const [id, setId] = useState(agent?.id || '');
  const [nome, setNome] = useState(agent?.nome || '');
  const [papel, setPapel] = useState(agent?.papel || '');
  const [ia, setIa] = useState(agent?.ia || 'claude');
  const [cmdText, setCmdText] = useState(agent?.cmd?.join(' ') || '');
  const [envText, setEnvText] = useState(envToText(agent?.env));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    const trimmedId = id.trim();
    const trimmedNome = nome.trim();
    const trimmedPapel = papel.trim();
    const cmd = splitCmd(cmdText);
    if (!trimmedId || !trimmedNome || !trimmedPapel || cmd.length === 0) {
      setError('Preencha id, nome, papel e comando.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = { id: trimmedId, nome: trimmedNome, papel: trimmedPapel, ia, cmd, env: parseEnvText(envText) };
      await onSubmit(payload);
      onSaved();
    } catch (e) {
      setError(e.message || 'Falha ao salvar agente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {error && <div style={styles.errorText}>{error}</div>}
      <div style={styles.formField}>
        <label style={styles.label} htmlFor="agent-id">ID</label>
        <input
          id="agent-id"
          style={{ ...styles.input, ...(isEdit ? styles.inputDisabled : {}) }}
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="claude-work"
          disabled={isEdit}
          autoFocus={!isEdit}
        />
      </div>
      <div style={styles.formField}>
        <label style={styles.label} htmlFor="agent-nome">Nome</label>
        <input
          id="agent-nome"
          style={styles.input}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Claude (Work)"
        />
      </div>
      <div style={styles.formField}>
        <label style={styles.label} htmlFor="agent-papel">Papel</label>
        <input
          id="agent-papel"
          style={styles.input}
          value={papel}
          onChange={(e) => setPapel(e.target.value)}
          placeholder="Assistente"
        />
      </div>
      <div style={styles.formField}>
        <label style={styles.label} htmlFor="agent-ia">IA</label>
        <select id="agent-ia" style={styles.select} value={ia} onChange={(e) => setIa(e.target.value)}>
          <option value="claude">claude</option>
          <option value="gemini">gemini</option>
          <option value="cursor">cursor</option>
          <option value="codex">codex</option>
          <option value="terminal">terminal</option>
        </select>
      </div>
      <div style={styles.formField}>
        <label style={styles.label} htmlFor="agent-cmd">Comando</label>
        <input
          id="agent-cmd"
          style={styles.input}
          value={cmdText}
          onChange={(e) => setCmdText(e.target.value)}
          placeholder="claude --settings ~/.claude-work"
        />
        <div style={styles.hint}>Comando de terminal usado para abrir o chat, dividido por espaço.</div>
      </div>
      <div style={styles.formField}>
        <label style={styles.label} htmlFor="agent-env">Variáveis de ambiente</label>
        <textarea
          id="agent-env"
          style={{ ...styles.input, minHeight: '72px', fontFamily: 'monospace', resize: 'vertical' }}
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
          placeholder={'CLAUDE_CONFIG_DIR=%USERPROFILE%\\.claude-work'}
        />
        <div style={styles.hint}>Opcional. Uma variável por linha (CHAVE=valor), aplicada só a este agente.</div>
      </div>
      <div style={styles.formFooter}>
        <button style={styles.cancelBtn} onClick={onCancel} disabled={saving}>Cancelar</button>
        <button style={{ ...styles.submitBtn, opacity: saving ? 0.6 : 1 }} onClick={handleSubmit} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </>
  );
}
