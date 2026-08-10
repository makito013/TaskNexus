// frontend/src/components/ProjectsRootSetting.jsx
// Pasta de projetos configurável pela UI (persistida em SettingsStore via
// GET/PUT/browse /api/settings/projects-root) — motivado pelo port pro
// Windows, onde o caminho de PROJECTS_ROOT muda de disco/pasta em relação
// ao Mac. Mesmo cuidado de AppearanceSwitch.jsx: window.location.reload()
// só roda DEPOIS que o PUT resolver com sucesso, nunca antes.
//
// Duas formas de escolher a pasta, ambas terminando no MESMO
// api.updateProjectsRoot(path): o botão "Procurar…" (diálogo nativo do SO,
// só funciona quando o backend roda na mesma máquina do usuário) e um campo
// de texto manual (acesso remoto — iPad/Tailscale — onde o diálogo nativo
// abriria na máquina errada). A validação do caminho é do backend
// (os.path.isdir + 400 com `detail`), então as duas formas herdam a mesma
// checagem e reportam erro pelo mesmo `error`/role="alert".
import { useState, useEffect } from 'react';
import { api } from '../services/api.js';

const styles = {
  wrap: {
    padding: '12px 10px',
    borderTop: '1px solid var(--v2-border, var(--border-strong, #2a2a2a))',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  heading: {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'var(--v2-text-faint, var(--text-muted, #666666))',
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  },
  pathText: {
    fontSize: '11px',
    color: 'var(--v2-text-dim, var(--text-secondary, #888888))',
    wordBreak: 'break-all',
  },
  browseBtn: {
    alignSelf: 'flex-start',
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid var(--v2-border, var(--border-strong, #2a2a2a))',
    background: 'transparent',
    color: 'var(--v2-text, var(--text-primary, #e0e0e0))',
    fontSize: '11px',
    cursor: 'pointer',
  },
  manualRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
  },
  manualInput: {
    flex: 1,
    minWidth: 0,
    boxSizing: 'border-box',
    padding: '6px 8px',
    borderRadius: '6px',
    border: '1px solid var(--v2-border, var(--border-strong, #2a2a2a))',
    background: 'var(--v2-surface-2, var(--bg-surface-2, #141414))',
    color: 'var(--v2-text, var(--text-primary, #e0e0e0))',
    fontSize: '11px',
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  },
  saveBtn: {
    flexShrink: 0,
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid var(--v2-border, var(--border-strong, #2a2a2a))',
    background: 'transparent',
    color: 'var(--v2-text, var(--text-primary, #e0e0e0))',
    fontSize: '11px',
    cursor: 'pointer',
  },
  error: {
    fontSize: '11px',
    color: 'var(--v2-danger, var(--destructive, #ff3333))',
  },
};

export function ProjectsRootSetting() {
  const [resolvedPath, setResolvedPath] = useState(null);
  const [loading, setLoading] = useState(true);
  const [browsing, setBrowsing] = useState(false);
  const [savingManual, setSavingManual] = useState(false);
  // O campo manual começa VAZIO, com o caminho atual só no placeholder (em
  // vez de pré-preenchido): pré-preencher convidaria a um PUT acidental do
  // mesmo valor — e o caminho atual já está visível logo acima, em
  // `pathText`.
  const [manualPath, setManualPath] = useState('');
  // Um único `error` para as duas formas (nativa e manual) — garante que
  // nunca há mais de um role="alert" vivo ao mesmo tempo.
  const [error, setError] = useState(null);

  const busy = browsing || savingManual;

  useEffect(() => {
    api.fetchProjectsRoot()
      .then((data) => setResolvedPath(data.resolved_path))
      .catch(() => setError('Falha ao carregar a pasta de projetos.'))
      .finally(() => setLoading(false));
  }, []);

  const handleBrowse = async () => {
    setBrowsing(true);
    setError(null);
    try {
      const { path } = await api.browseProjectsRootFolder();
      if (!path) {
        setBrowsing(false);
        return;
      }
      await api.updateProjectsRoot(path);
      // Só chega aqui se o PUT resolveu com sucesso — reload é a ÚLTIMA
      // linha do caminho feliz, nunca roda dentro do catch abaixo.
      window.location.reload();
    } catch (e) {
      setBrowsing(false);
      setError(e.message || 'Falha ao salvar a pasta de projetos. Verifique a conexão e tente novamente.');
    }
  };

  // Mesma sequência de handleBrowse, só trocando a origem do `path`: campo
  // digitado em vez do diálogo nativo. Campo vazio é no-op (espelha o
  // "usuário cancelou o diálogo" acima) — quem valida se o caminho EXISTE é
  // o backend (400 + detail), que cai no catch e vira o mesmo role="alert".
  const handleSaveManual = async () => {
    const path = manualPath.trim();
    if (!path) return;
    setSavingManual(true);
    setError(null);
    try {
      await api.updateProjectsRoot(path);
      window.location.reload();
    } catch (e) {
      setSavingManual(false);
      setError(e.message || 'Falha ao salvar a pasta de projetos. Verifique a conexão e tente novamente.');
    }
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.heading}>Pasta de projetos</div>
      {loading ? (
        <div style={styles.pathText}>Carregando…</div>
      ) : (
        <>
          <div style={styles.pathText}>{resolvedPath}</div>
          <button style={styles.browseBtn} onClick={handleBrowse} disabled={busy}>
            {browsing ? 'Selecionando…' : 'Procurar…'}
          </button>
          <div style={styles.manualRow}>
            <input
              style={styles.manualInput}
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder={resolvedPath || 'D:\\projetos'}
              aria-label="Caminho da pasta de projetos"
              disabled={busy}
            />
            <button style={styles.saveBtn} onClick={handleSaveManual} disabled={busy || !manualPath.trim()}>
              {savingManual ? 'Salvando…' : 'Salvar pasta'}
            </button>
          </div>
        </>
      )}
      {error && <div role="alert" style={styles.error}>{error}</div>}
    </div>
  );
}
