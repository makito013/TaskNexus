// frontend/src/features/artifacts/ImportArtifactsModal.jsx
// Fase A (07-planejamento-artefatos.md, 7.2 item 6): "Importar do projeto…" —
// traz para a galeria os .md/.html/.pdf que JÁ existem no projeto (o backend
// lista até 300, ignorando pastas ocultas, node_modules, build, subprojetos e
// o que já é artefato; 7.10.2 item 11). Caixas de seleção, "Selecionar todos"
// e POST /api/artifacts/import.
//
// O projeto vem pré-escolhido pelo filtro da tela; o select deixa trocar entre
// os projetos do escopo (em "Todos", entre todos) — importar exige UM projeto,
// e o Bruno pode estar olhando o cliente inteiro.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CenteredModal } from '../../layouts/v2/CenteredModal.jsx';
import { compareProjectPaths } from '../../utils/projects.js';
import { formatBytes } from '../viewer/viewerPaths.js';
import { KIND_LABEL, groupLabel } from './artifactModel.js';
import { importArtifacts, listCandidates } from './artifactsApi.js';

/**
 * @param {object} props
 * @param {object[]} props.projects          projetos que o select oferece
 * @param {object[]} props.allProjects       lista inteira (para os rótulos)
 * @param {string|null} props.initialProjectId
 * @param {() => void} props.onClose
 * @param {(result: {created:number, artifacts:object[], errors:object[]}) => void} props.onImported
 */
export function ImportArtifactsModal({ projects = [], allProjects = [], initialProjectId = null, onClose, onImported }) {
  const selectRef = useRef(null);
  const options = useMemo(
    () => [...projects].sort((a, b) => compareProjectPaths(a.id, b.id)),
    [projects],
  );
  const [projectId, setProjectId] = useState(
    () => (options.some((p) => p.id === initialProjectId) ? initialProjectId : options[0]?.id || null),
  );
  const [state, setState] = useState({ status: 'idle', candidates: [], truncated: false, error: null });
  const [selected, setSelected] = useState(() => new Set());
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState([]);

  useEffect(() => {
    if (!projectId) return undefined;
    const controller = new AbortController();
    setState({ status: 'loading', candidates: [], truncated: false, error: null });
    setSelected(new Set());
    setImportErrors([]);
    listCandidates(projectId, { signal: controller.signal })
      .then(({ candidates, truncated }) => {
        if (!controller.signal.aborted) setState({ status: 'ready', candidates, truncated, error: null });
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setState({ status: 'error', candidates: [], truncated: false, error: error?.message || 'Não consegui listar os arquivos.' });
      });
    return () => controller.abort();
  }, [projectId]);

  const toggle = (path) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const allSelected = state.candidates.length > 0 && selected.size === state.candidates.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(state.candidates.map((c) => c.path)));
  };

  const submit = async () => {
    if (!projectId || selected.size === 0) return;
    setImporting(true);
    setImportErrors([]);
    try {
      const result = await importArtifacts(projectId, Array.from(selected));
      onImported(result);
      if (result.errors.length === 0) {
        onClose();
        return;
      }
      // Sucesso parcial: os que deram certo saem da lista; os outros ficam
      // marcados, com o motivo embaixo.
      const failed = new Set(result.errors.map((e) => e.caminho));
      setState((prev) => ({ ...prev, candidates: prev.candidates.filter((c) => failed.has(c.path)) }));
      setSelected(failed);
      setImportErrors(result.errors);
    } catch (error) {
      setImportErrors([{ caminho: '', erro: error?.message || 'Não consegui importar.' }]);
    } finally {
      setImporting(false);
    }
  };

  let body;
  if (!projectId) {
    body = <div className="af-hint">Nenhum projeto neste filtro.</div>;
  } else if (state.status === 'loading' || state.status === 'idle') {
    body = <div className="af-hint" aria-busy="true">Procurando .md, .html e .pdf no projeto…</div>;
  } else if (state.status === 'error') {
    body = <div className="af-error" role="alert">{state.error}</div>;
  } else if (state.candidates.length === 0) {
    body = <div className="af-hint">Nenhum .md, .html ou .pdf novo neste projeto — o que existe já está em Artefatos.</div>;
  } else {
    body = (
      <>
        <label className="af-candidate" style={{ fontWeight: 600 }}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          <span style={{ flex: 1 }}>Selecionar todos ({state.candidates.length})</span>
        </label>
        <div className="af-candidates" data-testid="import-candidates">
          {state.candidates.map((c) => (
            <label key={c.path} className="af-candidate">
              <input type="checkbox" checked={selected.has(c.path)} onChange={() => toggle(c.path)} />
              <span className={`af-badge af-badge--${c.kind}`}>{KIND_LABEL[c.kind] || c.kind}</span>
              <span className="af-candidate-path" title={c.path}>{c.path}</span>
              {Number.isFinite(c.size) && <span className="af-candidate-size">{formatBytes(c.size)}</span>}
            </label>
          ))}
        </div>
        {state.truncated && (
          <div className="af-hint" style={{ marginTop: '8px' }}>Mostrando os primeiros 300 arquivos.</div>
        )}
      </>
    );
  }

  return (
    <CenteredModal open onClose={onClose} ariaLabel="Importar do projeto" initialFocusRef={selectRef}>
      <div className="af-modal" data-testid="import-artifacts-modal">
        <div className="af-modal-head">
          <span className="af-modal-title">Importar do projeto</span>
          <button type="button" className="af-modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="af-modal-body">
          <label className="af-field">
            Projeto
            <select
              ref={selectRef}
              className="af-select"
              value={projectId || ''}
              onChange={(e) => setProjectId(e.target.value || null)}
            >
              {options.map((p) => (
                <option key={p.id} value={p.id}>{groupLabel(p.id, allProjects)}</option>
              ))}
            </select>
          </label>
          {body}
          {importErrors.length > 0 && (
            <ul className="af-error" role="alert" style={{ margin: '10px 0 0', paddingLeft: '18px' }}>
              {importErrors.map((e) => (
                <li key={e.caminho || e.erro}>{e.caminho ? `${e.caminho}: ` : ''}{e.erro}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="af-modal-foot">
          <button type="button" className="af-btn" onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className="af-btn af-btn--primary"
            disabled={selected.size === 0 || importing}
            onClick={submit}
          >
            {importing ? 'Importando…' : `Importar${selected.size ? ` ${selected.size}` : ''}`}
          </button>
        </div>
      </div>
    </CenteredModal>
  );
}
