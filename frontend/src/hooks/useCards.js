// frontend/src/hooks/useCards.js
// Board (Kanban por projeto) state — o hook mais importante do Board (Fase
// 05-tarefas-board-jira, 05-TL.md Tarefa 18): todo componente visual
// (CardItem, KanbanBoard, BoardView, etc — tarefas 19-26) depende dele.
//
// Key design decisions:
//
// - Filtro de projeto é PARÂMETRO do hook: `useCards(selectedProjectIds)`,
//   não "busca tudo e quem usa filtra localmente". Motivo: o backend já
//   suporta filtro nativo (`GET /api/cards?projeto_id=a&projeto_id=b`,
//   05-ARQUITETO.md §2), então repassar o filtro evita trazer/reter em
//   memória cards de projetos que o usuário nem tem selecionados — e
//   `BoardView` (Tarefa 26) já é dona de `selectedProjectIds` via
//   localStorage, então o parâmetro tem uma fonte natural. `selectedProjectIds`
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

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../services/api.js';

const CARDS_POLL_INTERVAL_MS = 5000;

function recomputeResumo(subcards) {
  if (!subcards || !subcards.length) return null;
  return {
    total: subcards.length,
    feitos: subcards.filter((s) => s.status === 'feito').length,
  };
}

// Aplica `updater` ao card com `cardId`, procurando primeiro no nível de
// topo e depois dentro de `subcards` de cada card de topo. Ao atualizar um
// subcard, recalcula `subcards_resumo` do pai a partir da lista já
// atualizada (não confia em contagem antiga).
function updateCardInTree(cards, cardId, updater) {
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
        return { ...card, subcards: nextSubcards, subcards_resumo: recomputeResumo(nextSubcards) };
      }
    }
    return card;
  });
  return touched ? next : cards;
}

// Remove o card com `cardId` do estado local, seja ele de topo (remove o
// próprio + subcards aninhados junto, de graça) ou um subcard (remove da
// lista `subcards` do pai e recalcula `subcards_resumo`).
function removeCardFromTree(cards, cardId) {
  const withoutTop = cards.filter((c) => c.id !== cardId);
  if (withoutTop.length !== cards.length) return withoutTop;

  return cards.map((card) => {
    if (!card.subcards || !card.subcards.length) return card;
    const nextSubcards = card.subcards.filter((s) => s.id !== cardId);
    if (nextSubcards.length === card.subcards.length) return card;
    return { ...card, subcards: nextSubcards, subcards_resumo: recomputeResumo(nextSubcards) };
  });
}

export function useCards(selectedProjectIds) {
  const [cards, setCards] = useState([]);

  // Chave estável derivada de `selectedProjectIds` (ordenada + joinada) em
  // vez da referência do array — BoardView pode passar um array literal
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

  const fetchCards = useCallback(async () => {
    try {
      const list = await api.fetchCards(selectedProjectIds);
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
  // currently active filter — BoardV2 (Cliente A selected in the sidebar
  // while the active chat's project belongs to client B: "+ Add card" still
  // creates in B on purpose, chat project drives creation target) or
  // BoardView v1 (CardFormModal's Cliente/Projeto selects are independent
  // of the board's active filter, so the user can pick a different client
  // or subproject than the one currently filtered) — must NOT have the
  // created card flash-then-vanish on a board filtered to something else.
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
        return { ...card, subcards: nextSubcards, subcards_resumo: recomputeResumo(nextSubcards) };
      }));
      return created;
    } catch (e) {
      alert('Falha ao criar subtarefa. Tente novamente.');
      throw e;
    }
  }, []);

  const updateCard = useCallback(async (cardId, payload) => {
    try {
      const updated = await api.updateCard(cardId, payload);
      setCards((prev) => updateCardInTree(prev, cardId, (card) => ({
        ...card,
        titulo: updated.titulo,
        descricao: updated.descricao,
        status: updated.status,
        ultima_atualizacao_por: updated.ultima_atualizacao_por,
        atualizado_em: updated.atualizado_em,
        // imagens/subcards/subcards_resumo propositalmente NÃO vêm de
        // `updated` — ver nota no topo do arquivo sobre a resposta do PATCH
        // sempre vir com esses campos vazios/null.
      })));
      return updated;
    } catch (e) {
      alert('Falha ao atualizar card. Tente novamente.');
      throw e;
    }
  }, []);

  const deleteCard = useCallback(async (cardId) => {
    try {
      const result = await api.deleteCard(cardId);
      setCards((prev) => removeCardFromTree(prev, cardId));
      return result;
    } catch (e) {
      alert('Falha ao excluir card. Tente novamente.');
      throw e;
    }
  }, []);

  const uploadCardImage = useCallback(async (cardId, file) => {
    try {
      const image = await api.uploadCardImage(cardId, file);
      setCards((prev) => updateCardInTree(prev, cardId, (card) => ({
        ...card,
        imagens: [...(card.imagens || []), image],
      })));
      return image;
    } catch (e) {
      alert('Falha ao enviar imagem. Tente novamente.');
      throw e;
    }
  }, []);

  const deleteCardImage = useCallback(async (cardId, imageId) => {
    try {
      await api.deleteCardImage(cardId, imageId);
      setCards((prev) => updateCardInTree(prev, cardId, (card) => ({
        ...card,
        imagens: (card.imagens || []).filter((img) => img.id !== imageId),
      })));
    } catch (e) {
      alert('Falha ao remover imagem. Tente novamente.');
      throw e;
    }
  }, []);

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
      // cards de TOPO do projeto com status 'feito' — subcards somem
      // junto por estarem aninhados. Ver nota no topo do arquivo.
      setCards((prev) => prev.filter((card) => !(card.projeto_id === projetoId && card.status === 'feito')));
      return result;
    } catch (e) {
      alert('Falha ao limpar concluídos. Tente novamente.');
      throw e;
    }
  }, []);

  return {
    cards,
    createCard,
    createSubcard,
    updateCard,
    deleteCard,
    uploadCardImage,
    deleteCardImage,
    previewClearFinished,
    clearFinished,
  };
}
