// frontend/src/features/artifacts/RenameArtifactDialog.jsx
// Fase A (7.2 item 5, "Renomear"): troca o título do cartão com
// PATCH /api/artifacts/{id} `{titulo}`. Um título escolhido aqui vira
// "explícito" no backend (7.10.2, item 1): o agente reabrir o arquivo não o
// sobrescreve. O arquivo no disco não é renomeado.
//
// CenteredModal (portal, Esc, faixa escura). Aqui o foco inicial vai, sim,
// para o campo de texto — ao contrário do "Novo chat": quem tocou em
// "Renomear" quer digitar, então o teclado do iPad subir é o esperado.
import { useRef, useState } from 'react';
import { CenteredModal } from '../../layouts/v2/CenteredModal.jsx';
import { renameArtifact } from './artifactsApi.js';

export function RenameArtifactDialog({ artifact, onClose, onRenamed }) {
  const inputRef = useRef(null);
  const [title, setTitle] = useState(artifact?.title || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError('O título não pode ficar vazio.');
      return;
    }
    if (trimmed === artifact.title) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await renameArtifact(artifact.artifact_id, trimmed);
      onRenamed(updated);
      onClose();
    } catch (err) {
      setError(err?.message || 'Não consegui renomear.');
      setSaving(false);
    }
  };

  return (
    <CenteredModal open onClose={onClose} ariaLabel="Renomear artefato" initialFocusRef={inputRef}>
      <form onSubmit={submit} className="af-modal">
        <div className="af-modal-head">
          <span className="af-modal-title">Renomear artefato</span>
          <button type="button" className="af-modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="af-modal-body">
          <label className="af-field">
            Título
            <input
              ref={inputRef}
              className="af-input"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              enterKeyHint="done"
            />
          </label>
          <div className="af-hint">O arquivo <code>{artifact.path}</code> continua com o mesmo nome.</div>
          {error && <div className="af-error" role="alert" style={{ marginTop: '8px' }}>{error}</div>}
        </div>
        <div className="af-modal-foot">
          <button type="button" className="af-btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="af-btn af-btn--primary" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </CenteredModal>
  );
}
