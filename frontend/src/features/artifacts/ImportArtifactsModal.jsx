// frontend/src/features/artifacts/ImportArtifactsModal.jsx
// Fase A (07-planejamento-artefatos.md, 7.2 item 6): "Importar do projeto…" —
// traz para a galeria os .md/.pdf/.html que JÁ existem no projeto (o backend
// ignora pastas ocultas, node_modules, build, subprojetos e o que já é
// artefato; 7.10.2 item 11). Caixas de seleção, "Selecionar todos" e
// POST /api/artifacts/import.
//
// Lista por data de alteração: a primeira carga pede só os últimos
// RECENT_WINDOW_DAYS dias (`window_days`); "Buscar mais antigos" refaz a
// chamada SEM janela (até 300 no total, mais recentes primeiro) e SUBSTITUI a
// lista — não há merge, então não há duplicata. Recentes e antigos são
// separados no cliente por `mtime >= since` (o `since` da primeira resposta).
//
// O projeto vem pré-escolhido pelo filtro da tela; o select deixa trocar entre
// os projetos do escopo (em "Todos", entre todos) — importar exige UM projeto,
// e o Bruno pode estar olhando o cliente inteiro.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CenteredModal } from '../../layouts/v2/CenteredModal.jsx';
import { compareProjectPaths } from '../../utils/projects.js';
import { formatBytes } from '../viewer/viewerPaths.js';
import { KIND_LABEL, formatModified, groupLabel, splitCandidatesBySince } from './artifactModel.js';
import { importArtifacts, listCandidates } from './artifactsApi.js';

const RECENT_WINDOW_DAYS = 5;
const SLOW_HINT_DELAY_MS = 2500;
const SKELETON_ROWS = 5;
const OLDER_SKELETON_ROWS = 3;

const EMPTY_LIST = {
  status: 'idle', candidates: [], truncated: false, since: null, hasOlder: false, error: '',
};

function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function SkeletonRows({ count }) {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} className="af-candidate af-candidate--skeleton" aria-hidden="true">
      <span /><span /><span />
    </div>
  ));
}

function CandidateRow({ candidate, checked, disabled, onToggle }) {
  const when = formatModified(candidate.mtime);
  const size = Number.isFinite(candidate.size) ? formatBytes(candidate.size) : '';
  const fullDate = when
    ? new Date(candidate.mtime * 1000).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' })
    : '';
  return (
    <label className="af-candidate">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onToggle(candidate.path)} />
      <span className={`af-badge af-badge--${candidate.kind}`}>{KIND_LABEL[candidate.kind] || candidate.kind}</span>
      <span className="af-candidate-text">
        <span className="af-candidate-path" title={candidate.path}>{candidate.path}</span>
        {(when || size) && (
          <span className="af-candidate-meta">
            {when && (
              <time dateTime={new Date(candidate.mtime * 1000).toISOString()} title={fullDate}>{when}</time>
            )}
            {when && size ? ' · ' : ''}
            {size}
          </span>
        )}
      </span>
    </label>
  );
}

function CandidateGroup({ testId, label, count, headingRef, items, selected, disabled, onToggle }) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} data-testid={testId}>
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className="af-group-label">{label} ({count})</h3>
      <div className="af-candidates">
        {items.map((candidate) => (
          <CandidateRow
            key={candidate.path}
            candidate={candidate}
            checked={selected.has(candidate.path)}
            disabled={disabled}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

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
  const controllerRef = useRef(null);
  const olderInFlightRef = useRef(false);
  const retryButtonRef = useRef(null);
  const olderButtonRef = useRef(null);
  const olderHeadingRef = useRef(null);
  const summaryRef = useRef(null);
  const selectAllRef = useRef(null);
  const hintId = useId();
  const options = useMemo(
    () => [...projects].sort((a, b) => compareProjectPaths(a.id, b.id)),
    [projects],
  );
  const [projectId, setProjectId] = useState(
    () => (options.some((p) => p.id === initialProjectId) ? initialProjectId : options[0]?.id || null),
  );
  const [list, setList] = useState(EMPTY_LIST);
  const [older, setOlder] = useState({ status: 'idle' });
  const [selected, setSelected] = useState(() => new Set());
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState([]);
  const [importSummary, setImportSummary] = useState(null);
  const [slowHint, setSlowHint] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (!projectId) return undefined;
    const controller = new AbortController();
    controllerRef.current = controller;
    olderInFlightRef.current = false;
    setList({ ...EMPTY_LIST, status: 'loading' });
    setOlder({ status: 'idle' });
    setSelected(new Set());
    setImportErrors([]);
    setImportSummary(null);
    setAnnouncement('');
    setSlowHint(false);
    listCandidates(projectId, { windowDays: RECENT_WINDOW_DAYS, signal: controller.signal })
      .then(({ candidates, truncated, since, hasOlder }) => {
        if (!controller.signal.aborted) setList({ status: 'ready', candidates, truncated, since, hasOlder, error: '' });
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setList({ ...EMPTY_LIST, status: 'error', error: error?.message || '' });
      });
    return () => controller.abort();
  }, [projectId, reloadToken]);

  // Slow-load hint: one timer per loading phase, cleared on unmount/finish.
  const loading = list.status === 'idle' || list.status === 'loading';
  useEffect(() => {
    if (!loading) {
      setSlowHint(false);
      return undefined;
    }
    const timer = setTimeout(() => setSlowHint(true), SLOW_HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loading, projectId, reloadToken]);

  // Focus moves to the retry control when a load fails, and to the "older"
  // heading once the old files are in (the button that had focus is gone).
  useEffect(() => {
    if (list.status === 'error') retryButtonRef.current?.focus();
  }, [list.status]);
  useEffect(() => {
    if (older.status === 'error') olderButtonRef.current?.focus();
    if (older.status === 'loaded') olderHeadingRef.current?.focus();
  }, [older.status]);
  useEffect(() => {
    if (importSummary) summaryRef.current?.focus();
  }, [importSummary]);

  const loadOlder = () => {
    if (olderInFlightRef.current || importing || !projectId) return;
    const controller = controllerRef.current;
    if (!controller || controller.signal.aborted) return;
    olderInFlightRef.current = true;
    setOlder({ status: 'loading' });
    listCandidates(projectId, { signal: controller.signal })
      .then(({ candidates, truncated }) => {
        if (controller.signal.aborted) return;
        olderInFlightRef.current = false;
        const { older: olderItems } = splitCandidatesBySince(candidates, list.since);
        setList((prev) => ({ ...prev, candidates, truncated }));
        // A file that vanished (or fell past the cut) must not reach the POST.
        const present = new Set(candidates.map((c) => c.path));
        setSelected((prev) => new Set([...prev].filter((path) => present.has(path))));
        setOlder({ status: 'loaded' });
        setAnnouncement(
          olderItems.length > 0
            ? `${pluralize(olderItems.length, 'arquivo mais antigo adicionado', 'arquivos mais antigos adicionados')}.`
            : 'Nada mais antigo neste projeto.',
        );
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        olderInFlightRef.current = false;
        setOlder({ status: 'error' });
      });
  };

  const toggle = (path) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const { candidates } = list;
  const ready = list.status === 'ready';
  const hasItems = ready && candidates.length > 0;
  const allSelected = hasItems && selected.size === candidates.length;
  const someSelected = hasItems && selected.size > 0 && !allSelected;
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected, hasItems]);
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(candidates.map((c) => c.path)));
  };

  const { recent, older: olderItems } = splitCandidatesBySince(
    candidates,
    older.status === 'loaded' ? list.since : null,
  );
  const olderLoaded = older.status === 'loaded';
  // The older fetch replaces the list and prunes the selection when it lands,
  // so importing mid-search could send a path that is about to vanish.
  const searchingOlder = older.status === 'loading';
  const showLoadOlder = ready && list.hasOlder && !list.truncated && !olderLoaded;
  const windowEmptyWithOlder = ready && candidates.length === 0 && showLoadOlder;

  const submit = async () => {
    if (!projectId || selected.size === 0 || searchingOlder) return;
    const sent = selected.size;
    setImporting(true);
    setImportErrors([]);
    setImportSummary(null);
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
      setList((prev) => ({ ...prev, candidates: prev.candidates.filter((c) => failed.has(c.path)) }));
      setSelected(failed);
      setImportErrors(result.errors);
      setImportSummary({ ok: Math.max(0, sent - result.errors.length), failed: result.errors.length });
    } catch (error) {
      setImportErrors([{ caminho: '', erro: error?.message || 'Não consegui importar.' }]);
    } finally {
      setImporting(false);
    }
  };

  const olderButtonLabel = older.status === 'loading' ? 'Buscando…' : older.status === 'error' ? 'Tentar de novo' : 'Buscar mais antigos';
  const olderButton = (
    <button
      type="button"
      ref={olderButtonRef}
      className="af-btn"
      data-testid="import-load-older"
      aria-disabled={older.status === 'loading' || importing ? 'true' : undefined}
      aria-busy={older.status === 'loading' ? 'true' : undefined}
      onClick={loadOlder}
    >
      {olderButtonLabel}
    </button>
  );
  const olderError = older.status === 'error' && (
    <div className="af-error" role="alert">Não consegui buscar os mais antigos.</div>
  );
  const truncatedHint = list.truncated && (
    <div className="af-hint">Mostrando os 300 arquivos mais recentes. Há mais arquivos além desse limite.</div>
  );

  let body;
  if (!projectId) {
    body = <div className="af-hint">Nenhum projeto neste filtro.</div>;
  } else if (loading) {
    body = (
      <div aria-busy="true">
        <div className="af-hint" role="status">
          {slowHint ? 'Ainda procurando… projetos grandes demoram um pouco.' : 'Procurando arquivos recentes…'}
        </div>
        <div className="af-candidates"><SkeletonRows count={SKELETON_ROWS} /></div>
      </div>
    );
  } else if (list.status === 'error') {
    body = (
      <div className="af-empty" role="alert">
        <div className="af-empty-title">Não consegui listar os arquivos.</div>
        {list.error && <div>{list.error}</div>}
        <button type="button" ref={retryButtonRef} className="af-btn" onClick={() => setReloadToken((n) => n + 1)}>
          Tentar de novo
        </button>
      </div>
    );
  } else if (windowEmptyWithOlder) {
    body = (
      <div className="af-empty">
        <div className="af-empty-title">Nada novo nos últimos {RECENT_WINDOW_DAYS} dias.</div>
        <div>Nenhum .md, .pdf ou .html foi modificado neste período.</div>
        <div className="af-more">
          {olderButton}
          {olderError}
        </div>
      </div>
    );
  } else if (candidates.length === 0) {
    body = (
      <div className="af-empty">
        <div className="af-empty-title">Nenhum arquivo para importar neste projeto.</div>
        <div>
          O que existe de .md, .pdf e .html já está em Artefatos, ou fica em pastas ocultas ou ignoradas (como node_modules).
          {options.length > 1 ? ' Tente escolher outro projeto na lista acima.' : ''}
        </div>
      </div>
    );
  } else {
    body = (
      <div aria-busy={importing ? 'true' : undefined}>
        <label className="af-candidate af-select-all">
          <input ref={selectAllRef} type="checkbox" checked={allSelected} disabled={importing} onChange={toggleAll} />
          <span>Selecionar todos ({candidates.length})</span>
        </label>
        <div data-testid="import-candidates">
          {recent.length > 0 && (
            <CandidateGroup
              testId="import-group-recent"
              label={`Últimos ${RECENT_WINDOW_DAYS} dias`}
              count={recent.length}
              items={recent}
              selected={selected}
              disabled={importing}
              onToggle={toggle}
            />
          )}
          {!olderLoaded && (
            <div className="af-more">
              {showLoadOlder && olderButton}
              {olderError}
              {truncatedHint}
            </div>
          )}
          {older.status === 'loading' && (
            <div>
              <h3 className="af-group-label">Mais antigos</h3>
              <div className="af-candidates"><SkeletonRows count={OLDER_SKELETON_ROWS} /></div>
            </div>
          )}
          {olderLoaded && olderItems.length > 0 && (
            <CandidateGroup
              testId="import-group-older"
              label="Mais antigos"
              count={olderItems.length}
              headingRef={olderHeadingRef}
              items={olderItems}
              selected={selected}
              disabled={importing}
              onToggle={toggle}
            />
          )}
          {olderLoaded && (
            <div className="af-more">
              {olderItems.length === 0 && <div className="af-hint">Nada mais antigo neste projeto.</div>}
              {truncatedHint}
            </div>
          )}
        </div>
      </div>
    );
  }

  let footerHint = '';
  if (importing) footerHint = `Importando ${pluralize(selected.size, 'arquivo', 'arquivos')}…`;
  else if (searchingOlder) footerHint = 'Aguarde a busca terminar';
  else if (hasItems) footerHint = selected.size > 0 ? pluralize(selected.size, 'selecionado', 'selecionados') : 'Marque ao menos um arquivo';
  else if (windowEmptyWithOlder) footerHint = 'Busque os mais antigos para escolher arquivos';

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
              disabled={importing}
              onChange={(e) => setProjectId(e.target.value || null)}
            >
              {options.map((p) => (
                <option key={p.id} value={p.id}>{groupLabel(p.id, allProjects)}</option>
              ))}
            </select>
          </label>
          {body}
          {importErrors.length > 0 && (
            <div className="af-error af-import-errors" role="alert">
              {importSummary && (
                <div ref={summaryRef} tabIndex={-1}>
                  {importSummary.ok} importado(s). Não consegui importar estes {importSummary.failed}:
                </div>
              )}
              <ul>
                {importErrors.map((e) => (
                  <li key={e.caminho || e.erro}>{e.caminho ? `${e.caminho}: ` : ''}{e.erro}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="af-sr-only" role="status" data-testid="import-announcement">{announcement}</div>
        </div>
        <div className="af-modal-foot">
          <span className="af-modal-foot-hint" id={hintId} data-testid="import-footer-hint">{footerHint}</span>
          <button type="button" className="af-btn" onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className="af-btn af-btn--primary"
            aria-describedby={hintId}
            disabled={selected.size === 0 || importing || searchingOlder}
            onClick={submit}
          >
            {importing ? 'Importando…' : `Importar${selected.size ? ` ${selected.size}` : ''}`}
          </button>
        </div>
      </div>
    </CenteredModal>
  );
}
