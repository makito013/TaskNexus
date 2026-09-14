// frontend/src/layouts/v2/NewChatSheet.jsx
// Feature Clientes na sidebar v2 (Bloco C) — conteúdo de domínio do "+ Novo
// chat" da ChatSidebarV2. Substitui o antigo dropdown inline de agente (que só
// existia pra escolher a IA dentro do projeto já selecionado na SidebarV2) por
// um formulário completo: agora um chat pode nascer em QUALQUER subprojeto do
// cliente selecionado e com QUALQUER agente do registro global — não mais só
// os agentes configurados no `.escritorio/agents.yaml` daquele projeto.
//
// Lista de agentes vem de `useAgentSettings()` (mesmo hook que
// ConfiguracaoV2.jsx já usa pro CRUD de /api/agents) — é
// o registro GLOBAL, não `cliente.agentes` (que só reflete o que está
// configurado por projeto).
//
// CASCATA DE PROJETO — 2 NÍVEIS (esta rodada). O select achatado único
// ("principal / ymcy_backend" numa só linha) morreu; agora são dois `<select>`
// nativos encadeados:
//   nível 1 "Projeto principal" = filhos DIRETOS do cliente
//     (`listPrimaryProjectsForClient`). INCLUI pastas agrupadoras não
//     elegíveis: elas são passo de navegação, não alvo de chat.
//   nível 2 "Subprojeto"        = descendentes ELEGÍVEIS do primário, em
//     qualquer profundidade (`listSubProjectsForPrimary`). O `<select>` de
//     nível 2 só é MONTADO quando existe pelo menos um subprojeto — pedido
//     literal do Bruno; sem subprojeto o que aparece é um hint dizendo onde o
//     chat vai cair.
// `listSubProjectsForClient` (o modelo achatado) continua em utils/projects.js,
// congelado, mas não é mais consumido aqui.
//
// Modo "Todos": quando o chamador não tem um cliente fixo
// pra passar (`cliente` null — sidebar filtrada em "Todos"), passa `clientes`
// (a lista inteira) em vez disso. Aí este sheet ganha um select de CLIENTE
// como primeiro campo; escolher um resolve `activeClient` localmente
// (`selectedClientId`) e o resto do formulário segue a mesma lógica, só que a
// partir do cliente escolhido em vez do fixo. Quando `cliente` vem preenchido
// (fluxo de sempre), `clientes` é ignorado e nada muda.
//
// `presentation` ('sheet' | 'modal', default 'sheet'): o breakpoint de 640px
// do AppV2 decide qual container este componente monta — BottomSheet
// (mobile/toque) ou CenteredModal (desktop/iPad landscape). A diferença fica
// isolada na CASCA (qual wrapper, header com botão × ou não): o bloco de
// campos é um render ÚNICO, compartilhado pelos 2 branches — ver
// `fieldsContent` abaixo.
import { useEffect, useMemo, useRef, useState } from 'react';
import { BottomSheet } from './BottomSheet.jsx';
import { CenteredModal } from './CenteredModal.jsx';
import { useAgentSettings } from '../../hooks/useAgentSettings.js';
import {
  listPrimaryProjectsForClient,
  listSubProjectsForPrimary,
} from '../../utils/projects.js';

// Fixed ids — referenced by aria-describedby/htmlFor, so they are part of the
// accessibility contract, not decoration.
const PRIMARY_ERROR_ID = 'newchat-primary-error';
const SUBPROJECT_SELECT_ID = 'newchat-subproject-select';
const SUBPROJECT_HINT_ID = 'newchat-subproject-hint';

const RETRY_IDLE_LABEL = 'Carregar os projetos de novo';
const RETRY_BUSY_LABEL = 'Carregando os projetos…';

// Screen-reader announcements for the cascade, one curated string per state.
// Ids match the design's L1-*/L2-* table — the visible strings and the spoken
// ones are deliberately NOT the same text, so do not "deduplicate" them.
// The region is aria-atomic, so every string has to stand on its own.
// `Carregar os projetos de novo` appears verbatim inside L1-c: renaming the
// retry button means editing that string too.
const liveMessages = {
  // Client picked (Todos mode) and level 1 populated.
  L1b: (count, clientName) => (count === 1
    ? `1 projeto principal para ${clientName}. Escolha o projeto principal.`
    : `${count} projetos principais para ${clientName}. Escolha um projeto principal.`),
  // Client picked and level 1 came back empty (load failure / no children).
  L1c: (clientName) => `Não foi possível carregar os projetos de ${clientName} agora. Use o botão ${RETRY_IDLE_LABEL}.`,
  // Retry succeeded — the only state that mentions focus, because it moves it.
  L1d: (count) => (count === 1
    ? 'Projeto carregado. Foco no campo Projeto principal.'
    : `Projetos carregados, ${count} disponíveis. Foco no campo Projeto principal.`),
  // Retry failed again.
  L1e: (clientEligible, clientName) => (clientEligible
    ? `Ainda não foi possível carregar os projetos agora. Ou comece o chat na raiz de ${clientName}.`
    : 'Ainda não foi possível carregar os projetos agora.'),
  // Level 1 back to "Raiz de {cliente}".
  L2a: (clientEligible, clientName) => (clientEligible
    ? `O chat vai abrir na raiz de ${clientName}.`
    : `A raiz de ${clientName} não recebe chat. Escolha um projeto principal.`),
  // Level 1 = eligible project WITH subprojects.
  L2b: (count, primaryLabel) => (count === 1
    ? `Campo Subprojeto disponível, 1 opção. Padrão: Todo o ${primaryLabel}.`
    : `Campo Subprojeto disponível, ${count} opções. Padrão: Todo o ${primaryLabel}.`),
  // Level 1 = eligible project WITHOUT subprojects.
  L2c: (primaryLabel) => `${primaryLabel} não tem subprojetos. O chat abre nele.`,
  // Level 1 = grouping folder WITH subprojects (submit stays locked).
  L2d: (count) => (count === 1
    ? 'Campo Subprojeto disponível, 1 opção. Escolha o subprojeto para criar o chat.'
    : `Campo Subprojeto disponível, ${count} opções. Escolha um subprojeto para criar o chat.`),
  // Level 1 = grouping folder WITHOUT eligible subprojects (rare, state E).
  L2e: () => 'Nenhum subprojeto disponível agora. Escolha outro projeto principal.',
};

const styles = {
  title: {
    fontSize: '15px',
    fontWeight: 600,
    color: 'var(--v2-text)',
    padding: '4px 0 16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginBottom: '16px',
  },
  label: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--v2-text-dim)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  },
  select: {
    height: '44px',
    padding: '0 10px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
    color: 'var(--v2-text)',
    fontSize: '13px',
    // With the panel's width now pinned, a <select> would stretch on the flex
    // cross-axis by accident. These three make it fill the body predictably
    // and keep a long <option> from blowing the field out.
    width: '100%',
    boxSizing: 'border-box',
    minWidth: 0,
  },
  hint: {
    fontSize: '12px',
    color: 'var(--v2-text-dim)',
    lineHeight: 1.4,
    margin: 0,
  },
  // Same size as `hint`, but --v2-text instead of --v2-text-dim: used for a
  // hint that INSTRUCTS (explains why "Criar chat" is locked) rather than
  // describes. --v2-text-dim clears 4.5:1 by only 0.20 in the light theme —
  // too tight for load-bearing text.
  hintInstruction: {
    fontSize: '12px',
    color: 'var(--v2-text)',
    lineHeight: 1.4,
    margin: 0,
  },
  // Level-2 slot, OUTER node: stable, never keyed, carries only the floor.
  // `minHeight` (never `height`) and no `overflow: hidden` — taller content
  // must be able to grow the slot (WCAG 1.4.12 Text Spacing). 44px is exactly
  // a populated <select>, so swapping "1-line hint" for "<select> revealed"
  // moves nothing below it.
  subprojectSlot: {
    minHeight: '44px',
  },
  retryButton: {
    minHeight: '44px',
    width: '100%',
    // Vertical padding, not just the 44px floor: the label can wrap on a
    // narrow viewport, and `minHeight` (never `height`) has to be free to grow.
    padding: '10px 12px',
    boxSizing: 'border-box',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
    color: 'var(--v2-accent-strong)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  // Busy state swaps the text COLOUR for another token that still clears
  // 4.5:1 — never an opacity multiplier, which would drop it below.
  retryButtonBusy: {
    minHeight: '44px',
    width: '100%',
    padding: '10px 12px',
    boxSizing: 'border-box',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
    color: 'var(--v2-text-dim)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'default',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginTop: '8px',
  },
  cancelBtn: {
    padding: '0 16px',
    height: '40px',
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'transparent',
    color: 'var(--v2-text-dim)',
    fontSize: '13px',
    cursor: 'pointer',
  },
  submitBtn: (disabled) => ({
    padding: '0 16px',
    height: '40px',
    borderRadius: '8px',
    border: '1px solid var(--v2-accent)',
    background: disabled ? 'transparent' : 'var(--v2-accent-soft)',
    color: disabled ? 'var(--v2-text-faint)' : 'var(--v2-accent-strong)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
  }),
  // Modal-only chrome (CenteredModal's 3 regions) — the field block above is
  // shared with sheet mode.
  modalHeader: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    padding: '14px 16px',
    borderBottom: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
  },
  modalHeaderTitle: {
    fontSize: '15px',
    fontWeight: 600,
    color: 'var(--v2-text)',
  },
  modalCloseBtn: {
    width: '40px',
    height: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: '8px',
    color: 'var(--v2-text-dim)',
    fontSize: '18px',
    lineHeight: 1,
    cursor: 'pointer',
  },
  modalBody: {
    flex: 1,
    // Stays 0: this is the scroll container, and pinning a floor here made the
    // panel's `overflow: hidden` clip the footer ("Criar chat" off-screen with
    // no reachable scroll) at 1366x768 @ 200% zoom. The content floor lives in
    // the INNER wrapper below instead.
    minHeight: 0,
    overflowY: 'auto',
    padding: '16px',
  },
  // Inner wrapper (modal only): keeps a short form from looking cramped
  // without constraining the scroll container. The BottomSheet has its own
  // height model and is left untouched.
  modalFieldsWrapper: {
    minHeight: '280px',
  },
  modalFooter: {
    flexShrink: 0,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    padding: '12px 16px',
    borderTop: '1px solid var(--v2-border)',
    background: 'var(--v2-surface-2)',
  },
};

export function NewChatSheet({
  open,
  onClose,
  cliente,
  clientes,
  projects = [],
  onSubmit,
  onRetryProjects,
  presentation = 'sheet',
}) {
  const { agents, loading } = useAgentSettings();
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedPrimaryId, setSelectedPrimaryId] = useState('');
  const [selectedSubprojectId, setSelectedSubprojectId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [retryPending, setRetryPending] = useState(false);
  const [retryJustResolved, setRetryJustResolved] = useState(false);
  // Live-region content. Starts '' and is ONLY ever written from a handler or
  // from an interaction-triggered effect — never during render. That is what
  // guarantees zero announcement on mount (opening the modal with the error
  // already on screen must stay silent; the retry button's aria-describedby
  // provides the context when focus lands on it).
  const [liveMessage, setLiveMessage] = useState('');

  const clientSelectRef = useRef(null);
  const primarySelectRef = useRef(null);
  const retryButtonRef = useRef(null);
  // ONE stable ref object for the whole session — CenteredModal's focus effect
  // depends on `[open]` only and reads `.current` at open time.
  const initialFocusRef = useRef(null);

  // Modo "Todos": sem `cliente` fixo, mas com uma lista pra escolher de. Só
  // faz sentido mostrar o select quando há o que escolher — lista vazia cai no
  // mesmo hint informativo que os outros campos já usam.
  const showClientSelect = !cliente && Array.isArray(clientes);
  const activeClient = cliente || (clientes || []).find((c) => c.id === selectedClientId) || null;

  const projectsById = useMemo(
    () => Object.fromEntries((projects || []).map((p) => [p.id, p])),
    [projects],
  );

  // Read from `projects`, NOT from `activeClient.elegivel`: this has to agree
  // with `canSubmit` below (same lookup, same source), or the hint could
  // promise "o chat abre na raiz" while the button stays locked. In practice
  // the two are the same object — ChatSidebarV2 builds both `cliente` and
  // `clientes` out of `projects` — but a caller that passes a client from
  // anywhere else would otherwise make the UI contradict itself.
  // A client root is NOT guaranteed eligible: scan_projects synthesises a
  // parent folder with no .claude/.gemini/.codex of its own as
  // `elegivel: false`, so state A′ / the B-variant below are real.
  const clientEligible = !!activeClient && projectsById[activeClient.id]?.elegivel === true;

  const primaries = activeClient ? listPrimaryProjectsForClient(activeClient.id, projects) : [];
  const selectedPrimary = primaries.find((p) => p.id === selectedPrimaryId) || null;
  const subprojects = selectedPrimaryId ? listSubProjectsForPrimary(selectedPrimaryId, projects) : [];

  const targetProjectId = selectedSubprojectId || selectedPrimaryId || activeClient?.id || '';
  // Stricter than the old `!!activeClient`: a grouping folder (and a client
  // root without .claude/.gemini/.codex of its own) is NOT a valid chat
  // target — starting one there used to blow up with a LookupError in the
  // backend. The data invariant guarantees at least one eligible descendant,
  // so the cascade always offers a way down.
  const canSubmit = !!selectedAgentId && !!activeClient && projectsById[targetProjectId]?.elegivel === true;

  // Todos-mode, before a client is chosen: the level-1 select renders disabled
  // instead of being hidden (avoids a layout jump when a client gets picked).
  const primaryFieldPreChoice = showClientSelect && !activeClient;
  // Load error / empty client: the level-1 <select> gives way to an error line
  // + the retry button, and the level-2 slot unmounts entirely (state G).
  // `useProjects` exposes no loading/error channel, so "loading", "failed" and
  // "client with no children" are one and the same observable state.
  const errorInPrimarySlot = !!activeClient && primaries.length === 0;

  // CALLBACK REFS, not plain `ref={someRef}`. CenteredModal is a CHILD of this
  // component and React runs effects child -> parent, so an effect here that
  // wrote `initialFocusRef.current` would run AFTER the modal's focus effect
  // had already read `null`. Callback refs run during the commit, before any
  // effect. The three conditions are mutually exclusive, so exactly one of
  // them claims `initialFocusRef` per render.
  // Only safe because every reader of `initialFocusRef.current` is inside a
  // passive effect: these callbacks get a new identity each render, so React
  // detaches them (calling each with `null`) and reattaches on every commit.
  // Never read `initialFocusRef.current` during render.
  const setClientSelectRef = (el) => {
    clientSelectRef.current = el;
    if (primaryFieldPreChoice) initialFocusRef.current = el;
  };
  const setRetryButtonRef = (el) => {
    retryButtonRef.current = el;
    if (!primaryFieldPreChoice && errorInPrimarySlot) initialFocusRef.current = el;
  };
  const setPrimarySelectRef = (el) => {
    primarySelectRef.current = el;
    if (!primaryFieldPreChoice && !errorInPrimarySlot) initialFocusRef.current = el;
  };

  const title = activeClient ? `Novo chat em ${activeClient.nome}` : 'Novo chat';

  const handleClose = () => {
    // Reseta a seleção pra próxima abertura não herdar a escolha anterior
    // (cada abertura do sheet é um formulário novo, não uma sessão que
    // continua de onde parou).
    setSelectedClientId('');
    setSelectedPrimaryId('');
    setSelectedSubprojectId('');
    setSelectedAgentId('');
    setRetryPending(false);
    setRetryJustResolved(false);
    setLiveMessage('');
    onClose();
  };

  const handleClientChange = (e) => {
    const nextClientId = e.target.value;
    setSelectedClientId(nextClientId);
    // Um projeto/subprojeto escolhido pro cliente anterior não existe no novo.
    setSelectedPrimaryId('');
    setSelectedSubprojectId('');

    // Recomputed from `nextClientId`, NOT read off `primaries`/`activeClient`:
    // those still describe the PREVIOUS client during this handler, so the
    // count and the branch would be one interaction stale.
    const nextClient = (clientes || []).find((c) => c.id === nextClientId) || null;
    if (!nextClient) {
      setLiveMessage('');
      return;
    }
    const nextPrimaries = listPrimaryProjectsForClient(nextClient.id, projects);
    setLiveMessage(nextPrimaries.length === 0
      ? liveMessages.L1c(nextClient.nome)
      : liveMessages.L1b(nextPrimaries.length, nextClient.nome));
    // One trigger = one announcement: the primary reset above does NOT also
    // emit an L2-a, or VoiceOver would speak the transition twice.
  };

  const handlePrimaryChange = (e) => {
    const nextPrimaryId = e.target.value;
    setSelectedPrimaryId(nextPrimaryId);
    // A subproject left over from the previous primary would create the chat
    // in the wrong place.
    setSelectedSubprojectId('');

    const clientName = activeClient?.nome || '';
    if (nextPrimaryId === '') {
      setLiveMessage(liveMessages.L2a(clientEligible, clientName));
      return;
    }
    // `primaries` is still valid here (same client), but `subprojects` is not
    // — it describes the primary being replaced.
    const nextPrimary = primaries.find((p) => p.id === nextPrimaryId) || null;
    const nextSubprojects = listSubProjectsForPrimary(nextPrimaryId, projects);
    const primaryLabel = nextPrimary?.label || nextPrimaryId;

    if (nextSubprojects.length > 0) {
      setLiveMessage(nextPrimary?.eligible
        ? liveMessages.L2b(nextSubprojects.length, primaryLabel)
        : liveMessages.L2d(nextSubprojects.length));
      return;
    }
    setLiveMessage(nextPrimary?.eligible
      ? liveMessages.L2c(primaryLabel)
      : liveMessages.L2e());
  };

  const handleRetry = async () => {
    if (retryPending) return;
    setRetryPending(true);
    try {
      await onRetryProjects?.();
    } catch (err) {
      // `refreshProjects` already catches its own failures, so getting here
      // means a different callback threw. There is no error channel in this
      // UI (the outcome is inferred positionally below), but the failure must
      // not vanish silently — nor surface as an unhandled rejection.
      console.error('NewChatSheet: onRetryProjects failed', err);
    } finally {
      // `refreshProjects` swallows its own errors, so success and failure are
      // inferred POSITIONALLY (did `primaries` fill up?) by the effect below,
      // never from an error channel. The `finally` is what keeps a throwing
      // `onRetryProjects` from leaving the button stuck in its busy state.
      setRetryPending(false);
      setRetryJustResolved(true);
    }
  };

  // Runs on the render that already carries the refreshed `projects`, so
  // `primaries.length` is the outcome of the retry, not of the click.
  useEffect(() => {
    if (!retryJustResolved) return;
    setRetryJustResolved(false);
    if (primaries.length > 0) {
      // The button just unmounted; without this, focus would fall to <body>.
      primarySelectRef.current?.focus();
      setLiveMessage(liveMessages.L1d(primaries.length));
    } else {
      // The button uses aria-busy, not `disabled`, so focus never left it —
      // this is defensive.
      retryButtonRef.current?.focus();
      setLiveMessage(liveMessages.L1e(clientEligible, activeClient?.nome || ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryJustResolved, primaries.length]);

  const handleSubmit = () => {
    // Defesa em profundidade: ChatSidebarV2 já garante que não monta/abre
    // este sheet sem `cliente`/`clientes` válidos, mas se algo mudar isso no
    // futuro (ou este componente for reusado em outro lugar), evita o
    // TypeError de `activeClient.id` com `activeClient` null derrubando a
    // árvore inteira.
    if (!canSubmit || !activeClient) return;
    onSubmit(targetProjectId, selectedAgentId);
    handleClose();
  };

  // --- Level 2 (Subprojeto) ------------------------------------------------
  // The <select> only exists when there is something to choose; otherwise the
  // slot carries a hint saying where the chat will land.
  const subprojectSelectVisible = !!activeClient && selectedPrimaryId !== '' && subprojects.length > 0;
  // State D: a grouping folder is not a valid target, so the M2 hint explains
  // why "Criar chat" is locked. An eligible primary with subprojects does not
  // get it — option 1 ("Todo o {primário}") is already a valid choice. It also
  // unmounts the moment a real subproject IS picked: the instruction would
  // otherwise ask for an action already taken, while the button is enabled.
  const showSubprojectInstruction = subprojectSelectVisible
    && !selectedPrimary?.eligible
    && selectedSubprojectId === '';

  let subprojectSlotContent;
  if (!activeClient) {
    // State F — Todos mode, before a client is picked.
    subprojectSlotContent = (
      <span style={styles.hint}>
        O subprojeto aparece quando você escolher o cliente e o projeto principal.
      </span>
    );
  } else if (selectedPrimaryId === '') {
    // State B — level 1 sitting on "Raiz de {cliente}".
    subprojectSlotContent = (
      <span style={styles.hint}>
        {clientEligible
          ? `O chat abre na raiz de ${activeClient.nome}.`
          : `O chat não pode começar na raiz de ${activeClient.nome}. Escolha um projeto principal.`}
      </span>
    );
  } else if (subprojects.length > 0) {
    // State D (grouping folder) and the plain populated case (eligible
    // primary): same <select>, option 1 differs.
    subprojectSlotContent = (
      <select
        id={SUBPROJECT_SELECT_ID}
        style={styles.select}
        value={selectedSubprojectId}
        onChange={(e) => setSelectedSubprojectId(e.target.value)}
        aria-describedby={showSubprojectInstruction ? SUBPROJECT_HINT_ID : undefined}
      >
        <option value="">
          {selectedPrimary?.eligible ? `Todo o ${selectedPrimary.label}` : 'Selecione um subprojeto'}
        </option>
        {subprojects.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
    );
  } else if (selectedPrimary?.eligible) {
    // State C — eligible primary, no subprojects.
    subprojectSlotContent = (
      <span style={styles.hint}>
        {selectedPrimary.label} não tem subprojetos. O chat abre nele.
      </span>
    );
  } else {
    // State E — grouping folder with no eligible descendant. Rare (the data
    // invariant says it should not happen), and deliberately NOT auto-reverted
    // to the client root: the level-1 select is still mounted and operable.
    subprojectSlotContent = (
      <span style={styles.hintInstruction}>
        Nenhum subprojeto disponível agora. Escolha outro projeto principal.
      </span>
    );
  }

  const fieldsContent = (
    <>
      {/* Live region for the WHOLE cascade (level 1 + level 2). Mounted once,
          never keyed, never unmounted while the modal is open — a remounted
          aria-live node narrates inconsistently on VoiceOver/iPad. No `role`:
          role="status" together with aria-live causes double speech. */}
      <div aria-live="polite" aria-atomic="true" className="v2-sr-only">{liveMessage}</div>

      {showClientSelect && (
        <div style={styles.field}>
          <span style={styles.label}>Cliente</span>
          {clientes.length === 0 ? (
            <span style={styles.hint}>Nenhum cliente disponível.</span>
          ) : (
            <select
              ref={setClientSelectRef}
              style={styles.select}
              value={selectedClientId}
              onChange={handleClientChange}
              aria-label="Cliente"
            >
              <option value="">Selecione um cliente</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          )}
        </div>
      )}

      <div style={styles.field}>
        <span style={styles.label}>Projeto principal</span>
        {primaryFieldPreChoice ? (
          <select
            ref={setPrimarySelectRef}
            style={styles.select}
            value=""
            disabled
            onChange={() => {}}
            aria-label="Projeto principal"
          >
            <option value="">Escolha um cliente para ver os projetos</option>
          </select>
        ) : !activeClient ? null : errorInPrimarySlot ? (
          // State A / A′. The retry button is a sibling of the error line,
          // inside this same field — never inside the level-2 slot. It gets no
          // enter animation: an error state deserves quiet, and on open the
          // panel's own animation already covers the entrance.
          <>
            <p id={PRIMARY_ERROR_ID} style={styles.hint}>
              {clientEligible
                ? `Nenhum projeto disponível agora. O chat abre na raiz de ${activeClient.nome}.`
                : `Nenhum projeto disponível agora. O chat não pode começar na raiz de ${activeClient.nome}.`}
            </p>
            <button
              type="button"
              ref={setRetryButtonRef}
              aria-describedby={PRIMARY_ERROR_ID}
              aria-busy={retryPending}
              aria-disabled={retryPending}
              onClick={handleRetry}
              style={retryPending ? styles.retryButtonBusy : styles.retryButton}
            >
              {retryPending ? RETRY_BUSY_LABEL : RETRY_IDLE_LABEL}
            </button>
          </>
        ) : (
          <select
            ref={setPrimarySelectRef}
            style={styles.select}
            value={selectedPrimaryId}
            onChange={handlePrimaryChange}
            aria-label="Projeto principal"
          >
            <option value="">Raiz de {activeClient.nome}</option>
            {primaries.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        )}
      </div>

      {/* State G: when level 1 fell back to the error, the level-2 slot is
          REMOVED from the DOM (outer node included) — it does not collapse to
          min-height 0. No point reserving 44px for a field that cannot appear
          in that state. */}
      {!errorInPrimarySlot && (
        <div style={styles.field}>
          {/* M3 — the legend always renders; only the TAG changes. A <label
              htmlFor> pointing at an id that does not exist would be an orphan
              label, and hiding the legend entirely would make the field jump
              ~21px on every toggle. */}
          {subprojectSelectVisible ? (
            <label style={styles.label} htmlFor={SUBPROJECT_SELECT_ID}>Subprojeto</label>
          ) : (
            <span style={styles.label}>Subprojeto</span>
          )}

          {/* TWO NODES, on purpose — do not collapse into one.
              outer: stable, never keyed, holds the min-height floor.
              inner: keyed by the primary, so switching primaries REMOUNTS it
                     and the CSS enter animation replays (a class alone would
                     only ever animate once). */}
          <div style={styles.subprojectSlot}>
            <div key={selectedPrimaryId || 'raiz'} className="v2-cascade-field-enter">
              {subprojectSlotContent}
            </div>
          </div>

          {/* M2 — outside the reserved 44px box, in normal flow. */}
          {showSubprojectInstruction && (
            <p id={SUBPROJECT_HINT_ID} style={styles.hintInstruction}>
              Escolha um subprojeto para criar o chat.
            </p>
          )}
        </div>
      )}

      <div style={styles.field}>
        <span style={styles.label}>IA / Agente</span>
        {loading ? (
          <span style={styles.hint}>Carregando agentes…</span>
        ) : agents.length === 0 ? (
          <span style={styles.hint}>
            Nenhum agente cadastrado ainda. Use "+ Novo agente" para adicionar um.
          </span>
        ) : (
          <select
            style={styles.select}
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            aria-label="IA / Agente"
          >
            <option value="">Selecione um agente</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.nome}</option>
            ))}
          </select>
        )}
      </div>
    </>
  );

  const cancelButton = (
    <button type="button" style={styles.cancelBtn} onClick={handleClose}>
      Cancelar
    </button>
  );
  const submitButton = (
    <button
      type="button"
      style={styles.submitBtn(!canSubmit)}
      disabled={!canSubmit}
      onClick={handleSubmit}
    >
      Criar chat
    </button>
  );

  if (presentation === 'modal') {
    return (
      <CenteredModal open={open} onClose={handleClose} ariaLabel={title} initialFocusRef={initialFocusRef}>
        <header style={styles.modalHeader}>
          <span style={styles.modalHeaderTitle}>{title}</span>
          <span style={{ flex: 1 }} />
          <button type="button" style={styles.modalCloseBtn} onClick={handleClose} aria-label="Fechar">
            ×
          </button>
        </header>

        <div style={styles.modalBody}>
          <div style={styles.modalFieldsWrapper}>
            {fieldsContent}
          </div>
        </div>

        <footer style={styles.modalFooter}>
          {cancelButton}
          {submitButton}
        </footer>
      </CenteredModal>
    );
  }

  return (
    <BottomSheet open={open} onClose={handleClose}>
      <div style={styles.title}>{title}</div>

      {fieldsContent}

      <div style={styles.footer}>
        {cancelButton}
        {submitButton}
      </div>
    </BottomSheet>
  );
}
