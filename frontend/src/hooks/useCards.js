// frontend/src/hooks/useCards.js
// Board (Kanban por projeto) state — o hook mais importante do Board (Fase
// 05-tarefas-board-jira, 05-TL.md Tarefa 18): todo componente visual do Board
// (hoje layouts/v2/BoardV2.jsx e o CardFormModal que ele monta) depende dele.
//
// Key design decisions:
//
// - Filtro de projeto é PARÂMETRO do hook: `useCards(selectedProjectIds)`,
//   não "busca tudo e quem usa filtra localmente". Motivo: o backend já
//   suporta filtro nativo (`GET /api/cards?projeto_id=a&projeto_id=b`,
//   05-ARQUITETO.md §2), então repassar o filtro evita trazer/reter em
//   memória cards de projetos que o usuário nem tem selecionados — e a tela
//   do Board já é dona da cascata de filtro (useClienteProjetoFilter.js),
//   então o parâmetro tem uma fonte natural. `selectedProjectIds`
//   ausente/vazio busca cards de TODOS os projetos (sem query param).
//
// - Poll leve, mesmo espírito de useTasks.js: roda enquanto o componente que
//   usa o hook está montado. Diferente de useTasks (que só faz poll com o
//   drawer aberto), o Board É a tela principal enquanto montado — não há um
//   "drawer" pra gatear, então o poll roda sempre que o hook está montado.
//   Intervalo: 5000ms, mesmo valor de TASKS_POLL_INTERVAL_MS (useTasks.js) —
//   reaproveitado por já ser a cadência validada pro mesmo tipo de tela
//   (poll leve de dados que mudam com pouca frequência), sem motivo pra
//   divergir.
//
// - Todas as mutações (create/update/delete/upload/clearFinished) aplicam o
//   resultado da própria chamada ao estado local, SEM esperar um novo
//   `GET /api/cards` completo — "otimista" aqui significa isso (atualizar a
//   partir da resposta da própria mutação), não um flip-antes-do-await como
//   completeTask em useTasks.js: aqui sempre aguardamos a mutação resolver
//   antes de tocar no estado, então não há necessidade de reverter em caso
//   de erro (o estado nunca foi alterado otimisticamente ANTES da resposta).
//
// - Exceção: `clearFinished`. O backend não devolve quais ids foram
//   removidos, só contagens (`LimparConcluidosResult`). Em vez de um
//   refetch completo, filtramos localmente pela mesma regra determinística
//   documentada em 05-ARQUITETO.md §5.4: remove exatamente os cards de TOPO
//   do projeto com `status === 'feito'` (subcards somem junto, por estarem
//   aninhados dentro do pai no estado local) — e é exatamente isso que
//   05-TL.md Tarefa 18 pede ("cards removidos do estado local sem esperar
//   novo fetch completo").
//
// - Erros de qualquer MUTAÇÃO → alert() com mensagem específica, nunca
//   engolidos silenciosamente (mesmo padrão de completeTask/uncompleteTask
//   em useTasks.js). Erros do fetch inicial/poll (leitura) são tolerantes —
//   mantém o último estado conhecido, sem alert() a cada poll que falhar
//   (mesmo padrão de fetchTasksFor em useTasks.js).
//
// - `previewClearFinished` é uma leitura sob demanda (dispara ao abrir
//   ClearFinishedModal, Tarefa 25), não um poll de fundo — mas também não
//   dá alert() em caso de erro: propositalmente deixamos o erro propagar
//   pro chamador, porque quem chama é um modal com sua própria superfície
//   de UI de erro (ex.: mensagem inline "não foi possível carregar o
//   preview"), diferente de um alert() global bloqueante.
//
// - `createSubcard` has NO UI surface any more, and that is deliberate — do
//   NOT delete it as dead code. Subcards became MCP-only (Bruno's decision,
//   "cards/board v2" session): the `create-subcard` mode left CardFormModal
//   and the v1 board that mounted it was removed, but the agent path
//   (`criar_card` with `parent_id` -> `POST /api/cards/{id}/subcards`) is
//   live and is the only way subcards get created now. Same note sits on
//   `api.createSubcard`. The read side stays wired too: `subcards` /
//   `subcards_resumo` keep being hydrated and merged, because the edit modal
//   counts `card.subcards.length` for its cascade-delete warning.
//
// - Ponto de atenção para quem for ler/mexer em updateCard: a resposta de
//   `PATCH /api/cards/{id}` (backend/app/main.py:update_card) vem de
//   `CardStore.update()`, que internamente chama `get()` — e `get()` NÃO
//   hidrata `imagens`/`subcards`/`subcards_resumo` (só `list_top_level()`
//   faz isso). Ou seja, a resposta do PATCH sempre traz `imagens: []`,
//   `subcards: []`, `subcards_resumo: null`, mesmo que o card já tenha
//   imagens/subcards carregados localmente. `updateCard` abaixo faz merge
//   seletivo de campos (título/descrição/status/metadados) em vez de
//   substituir o card inteiro pela resposta — substituir apagaria
//   imagens/subcards já carregados. O mesmo NÃO é um problema em
//   createCard/createSubcard porque ali o card é novo (não tem
//   imagens/subcards prévios pra perder).

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../services/api.js';
import { applyCardMove } from '../utils/boardCardOrder.js';

const CARDS_POLL_INTERVAL_MS = 5000;

// `doneSlug === null` means the column list has not loaded yet (useColumns).
// The summary is then left EXACTLY as the backend sent it, instead of being
// recomputed against a "done" nobody knows yet — recomputing would flash a
// wrong "0 de 3" over a correct server-side count for one frame. No extra
// loading gate is needed for this: the null itself is the gate.
function recomputeResumo(subcards, doneSlug, previousResumo = null) {
  if (!subcards || !subcards.length) return null;
  if (doneSlug == null) return previousResumo;
  return {
    total: subcards.length,
    feitos: subcards.filter((s) => s.status === doneSlug).length,
  };
}

// Aplica `updater` ao card com `cardId`, procurando primeiro no nível de
// topo e depois dentro de `subcards` de cada card de topo. Ao atualizar um
// subcard, recalcula `subcards_resumo` do pai a partir da lista já
// atualizada (não confia em contagem antiga).
function updateCardInTree(cards, cardId, updater, doneSlug) {
  let touched = false;
  const next = cards.map((card) => {
    if (card.id === cardId) {
      touched = true;
      return updater(card);
    }
    if (card.subcards && card.subcards.length) {
      let subTouched = false;
      const nextSubcards = card.subcards.map((sub) => {
        if (sub.id === cardId) {
          subTouched = true;
          return updater(sub);
        }
        return sub;
      });
      if (subTouched) {
        touched = true;
        return {
          ...card,
          subcards: nextSubcards,
          subcards_resumo: recomputeResumo(nextSubcards, doneSlug, card.subcards_resumo),
        };
      }
    }
    return card;
  });
  return touched ? next : cards;
}

// Remove o card com `cardId` do estado local, seja ele de topo (remove o
// próprio + subcards aninhados junto, de graça) ou um subcard (remove da
// lista `subcards` do pai e recalcula `subcards_resumo`).
function removeCardFromTree(cards, cardId, doneSlug) {
  const withoutTop = cards.filter((c) => c.id !== cardId);
  if (withoutTop.length !== cards.length) return withoutTop;

  return cards.map((card) => {
    if (!card.subcards || !card.subcards.length) return card;
    const nextSubcards = card.subcards.filter((s) => s.id !== cardId);
    if (nextSubcards.length === card.subcards.length) return card;
    return {
      ...card,
      subcards: nextSubcards,
      subcards_resumo: recomputeResumo(nextSubcards, doneSlug, card.subcards_resumo),
    };
  });
}

// `doneSlug` comes from useColumns (the caller owns both hooks) rather than
// being fetched here: the two would otherwise race on mount and the board
// would hold two answers to "which column means done".
export function useCards(selectedProjectIds, doneSlug = null) {
  const [cards, setCards] = useState([]);

  // Chave estável derivada de `selectedProjectIds` (ordenada + joinada) em
  // vez da referência do array — quem chama pode passar um array literal
  // novo a cada render (`selectedProjectIds={[...]}`), e sem isso o efeito
  // de poll abaixo recriaria fetchCards (e reiniciaria o interval) a cada
  // render mesmo com o mesmo conteúdo.
  const projectIdsKey = useMemo(
    () => (selectedProjectIds && selectedProjectIds.length ? [...selectedProjectIds].sort().join(',') : ''),
    [selectedProjectIds]
  );

  // Membership set derived from the same stable key as `fetchCards` above —
  // `null` means "no active filter" (empty `selectedProjectIds`, i.e. every
  // project is in scope). Used by `createCard`'s optimistic append below to
  // decide whether the just-created card belongs on screen right now.
  const activeProjectIdsSet = useMemo(
    () => (projectIdsKey ? new Set(projectIdsKey.split(',')) : null),
    [projectIdsKey]
  );

  // Latest committed `cards`, for the rollback snapshot of an optimistic move.
  // A ref rather than the `cards` closure: `cards` as a dependency of
  // `moveCard` would rebuild that callback on every 5s poll, and capturing the
  // array from inside a `setCards` updater is worse — React may defer the
  // updater past the `await` that follows, leaving the snapshot null exactly
  // when a failure needs it.
  const cardsRef = useRef(cards);
  useEffect(() => { cardsRef.current = cards; }, [cards]);

  // -- poll coordination (task #43, phase 3) -------------------------------
  //
  // Two independent reasons to ignore a poll result, both counted/flagged in
  // REFS rather than state: a re-render is not wanted (nothing visual depends
  // on them) and, more importantly, the value has to be readable from inside
  // an async function that started before the drag did.
  //
  // There is nothing to reuse from useColumns here — that hook does no poll at
  // all ("NO poll, unlike useCards", see its header), so this mechanism is new
  // rather than generalised out of an existing one.
  // THREE guards, and each one catches a case the others do not. Found the
  // hard way: the counter alone looked sufficient and was not.
  //
  //   movesInFlightRef — a poll that STARTS and RESOLVES while a move is out.
  //   moveEpochRef     — a poll that started BEFORE the move and resolves
  //                      AFTER it already finished. The counter is back to 0
  //                      by then, so only a generation stamp catches this one,
  //                      and it is the likeliest of the three in real use: the
  //                      poll runs every 5s and a move takes milliseconds.
  //   cardDragActiveRef — a poll that starts and resolves entirely DURING a
  //                      drag, before any move exists to count or stamp.
  const movesInFlightRef = useRef(0);
  const moveEpochRef = useRef(0);
  const cardDragActiveRef = useRef(false);

  // Called by the board on drag start/end of a CARD. Column drags do NOT need
  // this: reordering columns never touches `cards`, so a poll landing mid-drag
  // cannot contradict anything the finger is doing.
  const setCardDragActive = useCallback((active) => {
    cardDragActiveRef.current = !!active;
  }, []);

  const fetchCards = useCallback(async () => {
    // Stamped BEFORE the request goes out, compared AFTER it comes back.
    const epochAtRequest = moveEpochRef.current;
    try {
      const list = await api.fetchCards(selectedProjectIds);
      // All three checks live HERE, after the await and immediately before the
      // write — never at the top of the tick. A tick-time check cannot see a
      // move that had not happened yet when the request left, which is the
      // whole problem: this response describes a board from before the drop,
      // and writing it would clobber the optimistic array AND the server's own
      // answer that has already been merged into it. Dropping the response is
      // safe — the next tick is 5s away and re-reads everything from scratch.
      if (moveEpochRef.current !== epochAtRequest) return;
      if (movesInFlightRef.current > 0 || cardDragActiveRef.current) return;
      setCards(list);
    } catch (e) {
      // Leitura tolerante — mantém o último estado conhecido, sem alert()
      // a cada poll que falhar (mesmo padrão de fetchTasksFor, useTasks.js).
      console.warn('fetchCards error (keeping last known state)', e);
    }
    // projectIdsKey (não selectedProjectIds) é a dependência real: ver
    // comentário acima sobre por que a referência do array não serve.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIdsKey]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => { if (!cancelled) fetchCards(); };
    tick();
    const interval = setInterval(tick, CARDS_POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [fetchCards]);

  // Bug fixed here: any caller whose creation target can fall outside the
  // currently active filter — BoardV2, where CardFormModal's Cliente/Projeto
  // selects are independent of the board's active filter, so the user can
  // pick a different client or subproject than the one currently filtered —
  // must NOT have the created card flash-then-vanish on a board filtered to
  // something else.
  // Root cause was this optimistic append running unconditionally: it added
  // the card to local state regardless of the active filter, so it showed
  // up immediately and then disappeared on the next 5s poll (which only
  // returns cards matching `selectedProjectIds`). Fix: only append
  // optimistically when the created card's `projeto_id` is actually inside
  // the active filter (or the filter is empty, i.e. "all projects"). When
  // it's outside the filter, we deliberately skip the append AND skip any
  // toast/feedback — the card is not stale, it is simply out of scope for
  // whatever the user is looking at right now, and the caller's own "+ Add
  // card" form already gives completion feedback (closes / stops showing
  // "Saving…") once this promise resolves. No shared toast component
  // exists in this codebase yet, so adding one here would be scope creep
  // for a one-line bug fix — see DEV report for the full rationale.
  const createCard = useCallback(async (payload) => {
    try {
      const created = await api.createCard(payload);
      if (!activeProjectIdsSet || activeProjectIdsSet.has(created.projeto_id)) {
        setCards((prev) => [...prev, created]);
      }
      return created;
    } catch (e) {
      alert('Falha ao criar card. Tente novamente.');
      throw e;
    }
  }, [activeProjectIdsSet]);

  const createSubcard = useCallback(async (parentId, payload) => {
    try {
      const created = await api.createSubcard(parentId, payload);
      setCards((prev) => prev.map((card) => {
        if (card.id !== parentId) return card;
        const nextSubcards = [...(card.subcards || []), created];
        return {
          ...card,
          subcards: nextSubcards,
          subcards_resumo: recomputeResumo(nextSubcards, doneSlug, card.subcards_resumo),
        };
      }));
      return created;
    } catch (e) {
      alert('Falha ao criar subtarefa. Tente novamente.');
      throw e;
    }
  }, [doneSlug]);

  const updateCard = useCallback(async (cardId, payload) => {
    try {
      const updated = await api.updateCard(cardId, payload);
      setCards((prev) => updateCardInTree(prev, cardId, (card) => ({
        ...card,
        titulo: updated.titulo,
        descricao: updated.descricao,
        status: updated.status,
        tipo: updated.tipo,
        prazo: updated.prazo,
        ultima_atualizacao_por: updated.ultima_atualizacao_por,
        atualizado_em: updated.atualizado_em,
        // imagens/subcards/subcards_resumo propositalmente NÃO vêm de
        // `updated` — ver nota no topo do arquivo sobre a resposta do PATCH
        // sempre vir com esses campos vazios/null.
      }), doneSlug));
      return updated;
    } catch (e) {
      alert('Falha ao atualizar card. Tente novamente.');
      throw e;
    }
  }, [doneSlug]);

  // Drag-to-reposition (task #43, phase 3). DISTINCT from updateCard, and the
  // difference is not cosmetic:
  //
  // - `updateCard` waits for the server before touching local state (see the
  //   header: "otimista" there means "apply the mutation's own answer"). That
  //   is fine for a form save and wrong for a drag — the card would snap back
  //   under the finger and then jump to its new slot a round-trip later.
  //   So this one is optimistic in the STRONG sense, like `reorderColumns` in
  //   useColumns.js: write locally first, roll back to the captured snapshot
  //   if the server refuses.
  //
  // - It never PATCHes. `POST /cards/{id}/move` is the only path that writes a
  //   fine-grained `board_position`; the PATCH deliberately re-appends a card
  //   to the end of the destination column, which is right for every caller
  //   that has no drop target (the status `<select>`, and the MCP agent whose
  //   contract does not change in this phase).
  //
  // Errors are RE-THROWN, never alert()ed here — the one mutation in this hook
  // that does not, and on purpose: a 409 means the board moved under the user,
  // which deserves an explanation that does not block the whole tab. The board
  // has a banner for it (see BoardV2). Same reasoning as useColumns.js.
  const moveCard = useCallback(async (cardId, { status, after_id = null, before_id = null }) => {
    const snapshot = cardsRef.current;
    setCards((prev) => applyCardMove(prev, cardId, {
      status, afterId: after_id, beforeId: before_id,
    }));

    movesInFlightRef.current += 1;
    // Invalidates every poll already in flight, including the ones that will
    // only come back after this move has finished.
    moveEpochRef.current += 1;
    try {
      const moved = await api.moveCard(cardId, { status, after_id, before_id });
      // The server is AUTHORITATIVE on `board_position` and `status`, so its
      // answer is merged in — but FIELD BY FIELD, never as a replacement. The
      // /move response comes from CardStore.get(), which does not hydrate
      // `imagens`/`subcards`/`subcards_resumo` (the same trap documented at
      // the top of this file for the PATCH response): replacing the object
      // would blank the card's images and make the edit modal's cascade-delete
      // warning read "0 subtarefas" until the next poll.
      //
      // The card's ARRAY position is left exactly where the optimistic splice
      // put it: it already agrees with the position the server just confirmed,
      // and re-sorting here would fight the animation that is still settling.
      setCards((prev) => updateCardInTree(prev, cardId, (card) => ({
        ...card,
        status: moved.status,
        board_position: moved.board_position,
        ultima_atualizacao_por: moved.ultima_atualizacao_por,
        atualizado_em: moved.atualizado_em,
      }), doneSlug));
      return moved;
    } catch (e) {
      // Back to the board the user was looking at when they picked the card
      // up. A snapshot, not a refetch — same call as useColumns.reorderColumns:
      // swapping the board for a freshly fetched different one right after a
      // failed drag is a second surprise on top of the first.
      setCards(snapshot);
      throw e;
    } finally {
      movesInFlightRef.current -= 1;
    }
  }, [doneSlug]);

  const deleteCard = useCallback(async (cardId) => {
    try {
      const result = await api.deleteCard(cardId);
      setCards((prev) => removeCardFromTree(prev, cardId, doneSlug));
      return result;
    } catch (e) {
      alert('Falha ao excluir card. Tente novamente.');
      throw e;
    }
  }, [doneSlug]);

  const uploadCardImage = useCallback(async (cardId, file) => {
    try {
      const image = await api.uploadCardImage(cardId, file);
      setCards((prev) => updateCardInTree(prev, cardId, (card) => ({
        ...card,
        imagens: [...(card.imagens || []), image],
      }), doneSlug));
      return image;
    } catch (e) {
      alert('Falha ao enviar imagem. Tente novamente.');
      throw e;
    }
  }, [doneSlug]);

  const deleteCardImage = useCallback(async (cardId, imageId) => {
    try {
      await api.deleteCardImage(cardId, imageId);
      setCards((prev) => updateCardInTree(prev, cardId, (card) => ({
        ...card,
        imagens: (card.imagens || []).filter((img) => img.id !== imageId),
      }), doneSlug));
    } catch (e) {
      alert('Falha ao remover imagem. Tente novamente.');
      throw e;
    }
  }, [doneSlug]);

  // Leitura sob demanda (não é poll de fundo) — ver nota no topo do arquivo
  // sobre por que não tem alert() aqui: o erro propaga pro chamador
  // (ClearFinishedModal, Tarefa 25) decidir sua própria UI de erro.
  const previewClearFinished = useCallback(async (projetoId) => {
    return api.previewClearFinished(projetoId);
  }, []);

  const clearFinished = useCallback(async (projetoId) => {
    try {
      const result = await api.clearFinished(projetoId);
      // Regra determinística (05-ARQUITETO.md §5.4): remove exatamente os
      // cards de TOPO do projeto na coluna CONCLUÍDA — subcards somem junto
      // por estarem aninhados. Ver nota no topo do arquivo. Com `doneSlug`
      // ainda null (colunas não carregadas), não remove nada localmente: o
      // poll de 5s traz a lista já sem eles, e apagar pelo palpite errado
      // sumiria com cards que o backend manteve.
      if (doneSlug != null) {
        setCards((prev) => prev.filter(
          (card) => !(card.projeto_id === projetoId && card.status === doneSlug)
        ));
      }
      return result;
    } catch (e) {
      alert('Falha ao limpar concluídos. Tente novamente.');
      throw e;
    }
  }, [doneSlug]);

  return {
    cards,
    createCard,
    createSubcard,
    updateCard,
    moveCard,
    setCardDragActive,
    deleteCard,
    uploadCardImage,
    deleteCardImage,
    previewClearFinished,
    clearFinished,
  };
}
