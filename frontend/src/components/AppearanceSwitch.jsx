// frontend/src/components/AppearanceSwitch.jsx
// Milestone 2 (plano Layout v2, 05-TL.md, Tarefa 13): controle de layout/tema
// compartilhado. Vive em components/ (não em layouts/v2/) e não depende de
// nada do contexto do v2 (sem useTerminal, sem v2Screen, sem import de
// dentro de layouts/v2/) — só das props abaixo e do próprio SettingsStore
// via api.js. Três pontos de montagem: o rodapé de layouts/v2/SidebarV2.jsx,
// o de layouts/v2/MobileMenuScreen.jsx e o de components/Sidebar.jsx (v1).
//
// O ponto de montagem no v1 NÃO é opcional: é o único caminho de UI de quem
// está no layout v1 para chegar ao v2. Sem ele o v1 vira uma armadilha de
// mão única, recuperável só via API/banco.
//
// Requisito mais importante (achado do TL, risco sinalizado explicitamente):
// window.location.reload() só pode rodar DEPOIS que o PUT /api/settings/
// appearance resolver com sucesso. Uma falha de rede/PUT nunca pode recarregar
// a página — o usuário ficaria preso num layout/tema que o backend não
// persistiu, sem nem saber que a troca não "colou".
//
// Sem botão "Aplicar": cada clique num segmento salva e recarrega na hora
// (pedido explícito do Bruno — um clique a mais era desnecessário). Por isso
// não há mais estado "pendente" separado do persistido: o valor exibido é
// sempre `initialAppearance`, e o controle de Tema só aparece quando o
// layout PERSISTIDO já é 'v2' (trocar para v2 e escolher o tema viram dois
// cliques/reloads em vez de um só — aceito em troca de tirar o botão).
import { useState } from 'react';
import { api } from '../services/api.js';

// Tokens com fallback explícito para os tokens v1 (--text-primary etc.) e, na
// ausência de QUALQUER um dos dois (ex.: montado fora de qualquer layout com
// tema aplicado), uma cor literal — mantém o componente utilizável em
// qualquer contexto, não só dentro de [data-layout="v2"].
const colors = {
  text: 'var(--v2-text, var(--text-primary, #e0e0e0))',
  textDim: 'var(--v2-text-dim, var(--text-secondary, #888888))',
  textFaint: 'var(--v2-text-faint, var(--text-muted, #666666))',
  border: 'var(--v2-border, var(--border-strong, #2a2a2a))',
  accent: 'var(--v2-accent, var(--accent-green, #4ade80))',
  accentText: 'var(--v2-bg, #0d0d0d)',
  danger: 'var(--v2-danger, var(--destructive, #ff3333))',
};

const styles = {
  wrap: {
    padding: '12px 10px',
    borderTop: `1px solid ${colors.border}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  heading: {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: colors.textFaint,
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  rowLabel: {
    fontSize: '11px',
    color: colors.textDim,
    minWidth: '46px',
    flexShrink: 0,
  },
  segments: {
    display: 'flex',
    gap: '4px',
    flex: 1,
  },
  segment: (active, disabled) => ({
    flex: 1,
    padding: '6px 8px',
    borderRadius: '6px',
    border: `1px solid ${colors.border}`,
    background: active ? colors.accent : 'transparent',
    color: active ? colors.accentText : colors.text,
    fontSize: '11px',
    fontWeight: active ? 600 : 500,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled && !active ? 0.6 : 1,
  }),
  savingHint: {
    fontSize: '11px',
    color: colors.textFaint,
  },
  error: {
    fontSize: '11px',
    color: colors.danger,
  },
};

function SegmentedControl({ label, value, options, onChange, ariaLabel, disabled }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}:</span>
      <div style={styles.segments} role="group" aria-label={ariaLabel}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            style={styles.segment(value === opt.value, disabled)}
            aria-pressed={value === opt.value}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AppearanceSwitch({ initialAppearance }) {
  const persistedLayout = initialAppearance?.layout_version || 'v1';
  const persistedTheme = initialAppearance?.theme_mode || 'dark';

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const showTheme = persistedLayout === 'v2';

  const applyChange = async (partial) => {
    setSaving(true);
    setError(null);
    try {
      await api.updateAppearance(partial);
      // Só chega aqui se o PUT resolveu com sucesso — reload é a ÚLTIMA linha
      // do caminho feliz, nunca roda dentro do catch abaixo.
      window.location.reload();
    } catch {
      setSaving(false);
      setError('Falha ao salvar preferências. Verifique a conexão e tente novamente.');
    }
  };

  const handleLayoutChange = (value) => {
    if (saving || value === persistedLayout) return;
    applyChange({ layout_version: value });
  };

  const handleThemeChange = (value) => {
    if (saving || value === persistedTheme) return;
    applyChange({ theme_mode: value });
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.heading}>Aparência</div>

      <SegmentedControl
        label="Layout"
        ariaLabel="Layout"
        value={persistedLayout}
        onChange={handleLayoutChange}
        disabled={saving}
        options={[
          { value: 'v1', label: 'v1' },
          { value: 'v2', label: 'v2' },
        ]}
      />

      {showTheme && (
        <SegmentedControl
          label="Tema"
          ariaLabel="Tema"
          value={persistedTheme}
          onChange={handleThemeChange}
          disabled={saving}
          options={[
            { value: 'dark', label: 'Escuro' },
            { value: 'light', label: 'Claro' },
          ]}
        />
      )}

      {saving && <div style={styles.savingHint}>Salvando…</div>}
      {error && <div role="alert" style={styles.error}>{error}</div>}
    </div>
  );
}
