// frontend/src/components/AppearanceSwitch.jsx
import { useState } from 'react';
import { api } from '../services/api.js';

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
  const persistedTheme = initialAppearance?.theme_mode || 'light';

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const applyChange = async (partial) => {
    setSaving(true);
    setError(null);
    try {
      await api.updateAppearance(partial);
      window.location.reload();
    } catch {
      setSaving(false);
      setError('Falha ao salvar preferências. Verifique a conexão e tente novamente.');
    }
  };

  const handleThemeChange = (value) => {
    if (saving || value === persistedTheme) return;
    applyChange({ theme_mode: value, layout_version: 'v2' });
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.heading}>Aparência</div>

      <SegmentedControl
        label="Tema"
        ariaLabel="Tema"
        value={persistedTheme}
        onChange={handleThemeChange}
        disabled={saving}
        options={[
          { value: 'light', label: 'Claro' },
          { value: 'dark', label: 'Escuro' },
        ]}
      />

      {saving && <div style={styles.savingHint}>Salvando…</div>}
      {error && <div role="alert" style={styles.error}>{error}</div>}
    </div>
  );
}
