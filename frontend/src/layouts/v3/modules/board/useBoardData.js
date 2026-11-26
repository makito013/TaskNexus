import { useCallback, useMemo, useState } from 'react'
import { api } from '../../../../services/api.js'
import { useCards } from '../../../../hooks/useCards.js'
import { useColumns } from '../../../../hooks/useColumns.js'
import { columnDeleteRefusal } from './columnErrors.js'

export { columnDeleteRefusal }

// The one place of the V3 board that talks to the board hooks (boardWriteGuard
// keeps every other file of this folder away from them). It composes the shared
// card and column hooks of the V2 with the options that make them quiet: a
// failed mutation becomes a notice here instead of a blocking alert(), and the
// card poll pauses while the tab is hidden.
//
// The columns are global; the cards are the ones of the scope (`scope.fetchIds`
// narrows the request, `scope.matches` keeps what the header filters ask for, such
// as the archived switch).
//
// Reading:
//   loading        the columns have not answered yet
//   columnsError   the columns could not be read and there is nothing to show
//   cardsLoaded    the first read of the current request answered
//   cardsStale     a later read failed: what is shown is the last good state
//   cardsError     the read of the CURRENT filter failed and none has worked yet for it
//                  (first read, or a change of project during an outage); it goes away only
//                  when a read works
//   refetchCards   reads again now
//   fetchedCards   every card the request returned, before the scope's filter
//
// Writing (columns; the caller shows what the server said, so these rethrow):
//   createColumn(label)  renameColumn(slug, label)  deleteColumn(slug)  (the last two also read
//                  the columns again when they fail: the column may be gone in another tab; a
//                  delete refused by a known reason does not, the column is there)
//   setDoneColumn(slug)  does not rethrow: a failure reads the columns again and becomes the
//                  notice { kind: 'done' }, which the next success clears
//   reorderColumns(slugs)  optimistic with the hook's rollback; resolves true, or false after
//                          reading the columns again and raising { kind: 'column' } (the API
//                          error of this call has no status, so every failure is treated alike)
// Writing (cards; none of these rethrow, a failure is the notice):
//   moveCard(cardId, { status, afterId, beforeId })  the drop between two neighbours, optimistic
//                  with rollback; resolves true/false. A conflict (409, or 400 coluna_inexistente)
//                  reads the columns again and raises { kind: 'board_changed' }, anything else
//                  { kind: 'card' }
//   changeColumn(cardId, slug)  the "Mover" select: a status change, which lands at the end of the
//                  column; not optimistic (the shared hook is not); failure is { kind: 'card' }
//   setCardDragActive(bool)  suspends the card poll while a card is held
//   moveNotice / dismissMoveNotice()  the banner above the board; it goes when dismissed or when
//                  the next move works
//   createCard(payload)  updateCard(id, patch)  deleteCard(id)  uploadImage(cardId, file)  deleteImage(cardId, imageId)
//   answerQuestion(cardId, questionId, text)  deleteQuestion(cardId, questionId)  previewClear(key)  executeClear(key)
//                  the dialogs' writes: they rethrow (the dialog tells the failure) and leave no generic notice;
//                  a failed update or delete whose card is no longer on the server rethrows { cardGone: true }
//   mutationError  the generic failure notice of the shared hook (the card dialogs clear it and show their own)
export function useBoardData({ scope }) {
  const [mutationError, setMutationError] = useState(null)
  const [moveNotice, setMoveNotice] = useState(null)
  const clearMutationError = useCallback(() => setMutationError(null), [])
  const handleMutationError = useCallback((message) => setMutationError({ message }), [])
  const dismissMoveNotice = useCallback(() => setMoveNotice(null), [])

  const {
    columns,
    loading,
    readError: columnsReadError,
    refetch: refetchColumns,
    doneSlug,
    createColumn,
    renameColumn: renameColumnHook,
    deleteColumn: deleteColumnHook,
    setDoneColumn: setDoneColumnHook,
    reorderColumns: reorderColumnsHook,
  } = useColumns()

  const {
    cards: fetchedCards,
    loaded: cardsLoaded,
    readError: cardsReadError,
    refetch: refetchCards,
    moveCard: moveCardHook,
    updateCard: updateCardHook,
    createCard: createCardHook,
    deleteCard: deleteCardHook,
    previewClearFinished,
    clearFinished,
    uploadCardImage,
    deleteCardImage,
    answerCardQuestion,
    deleteCardQuestion,
    setCardDragActive,
  } = useCards(
    scope.fetchIds,
    doneSlug,
    { onMutationError: handleMutationError, pauseWhenHidden: true, trackReadState: true },
  )

  const cards = useMemo(
    () => fetchedCards.filter((card) => scope.matches(card.projeto_id)),
    [fetchedCards, scope],
  )

  // A column request that fails may be about a column that is gone (deleted in another tab): read
  // the columns again so it stops being shown. The error still goes to the caller. A delete that the
  // server refused BY A REASON (cards in it, the done column, the last one) is no such case: the
  // column is there, and that is what the answer says.
  const renameColumn = useCallback(async (slug, label) => {
    try {
      return await renameColumnHook(slug, label)
    } catch (error) {
      refetchColumns()
      throw error
    }
  }, [renameColumnHook, refetchColumns])

  const deleteColumn = useCallback(async (slug) => {
    try {
      await deleteColumnHook(slug)
    } catch (error) {
      if (!columnDeleteRefusal(error)) refetchColumns()
      throw error
    }
  }, [deleteColumnHook, refetchColumns])

  const setDoneColumn = useCallback(async (slug) => {
    try {
      await setDoneColumnHook(slug)
      setMoveNotice(null)
      return true
    } catch (error) {
      console.warn('setDoneColumn error', error)
      refetchColumns()
      setMoveNotice({ kind: 'done' })
      return false
    }
  }, [setDoneColumnHook, refetchColumns])

  const reorderColumns = useCallback(async (slugs) => {
    try {
      await reorderColumnsHook(slugs)
      setMoveNotice(null)
      return true
    } catch (error) {
      console.warn('reorderColumns error', error)
      // The hook has already put the order back; read the columns so what is shown is the server's.
      refetchColumns()
      setMoveNotice({ kind: 'column' })
      return false
    }
  }, [reorderColumnsHook, refetchColumns])

  const moveCard = useCallback(async (cardId, { status, afterId = null, beforeId = null }) => {
    try {
      await moveCardHook(cardId, { status, after_id: afterId, before_id: beforeId })
      setMoveNotice(null)
      return true
    } catch (error) {
      console.warn('moveCard error', error)
      if (error && error.conflict) {
        refetchColumns()
        setMoveNotice({ kind: 'board_changed' })
      } else {
        setMoveNotice({ kind: 'card' })
      }
      return false
    }
  }, [moveCardHook, refetchColumns])

  const changeColumn = useCallback(async (cardId, slug) => {
    try {
      await updateCardHook(cardId, { status: slug })
      setMoveNotice(null)
      return true
    } catch (error) {
      console.warn('changeColumn error', error)
      // updateCard also raised the generic mutation error; the banner is the one message here.
      setMutationError(null)
      setMoveNotice({ kind: 'card' })
      return false
    }
  }, [updateCardHook])

  // -- card writes of the dialogs. The shared hook raises its generic notice and rethrows; the dialog that
  // asked tells the failure in its own place, so the generic one is cleared and nothing is said twice.
  const quiet = useCallback(async (run) => {
    try {
      return await run()
    } catch (error) {
      setMutationError(null)
      throw error
    }
  }, [])

  // The shared client raises errors WITHOUT a status, so "the card does not exist any more" is told by a
  // read: after a failed save or delete, an unfiltered read that no longer has the id (nor inside a
  // parent's subcards) turns the failure into { cardGone: true }. A read that fails, or a connection that
  // is down, leaves the common error.
  const quietCheckingExistence = useCallback(async (cardId, run) => {
    try {
      return await run()
    } catch (error) {
      setMutationError(null)
      if (error instanceof TypeError) throw error
      let list = null
      try {
        list = await api.fetchCards()
      } catch {
        list = null
      }
      const present = !Array.isArray(list)
        || list.some((entry) => entry.id === cardId || (entry.subcards || []).some((sub) => sub.id === cardId))
      if (present) throw error
      refetchCards()
      throw Object.assign(new Error('Card not found'), { cardGone: true })
    }
  }, [refetchCards])

  const createCard = useCallback((payload) => quiet(() => createCardHook(payload)), [quiet, createCardHook])
  const updateCard = useCallback(
    (cardId, patch) => quietCheckingExistence(cardId, () => updateCardHook(cardId, patch)),
    [quietCheckingExistence, updateCardHook],
  )
  const deleteCard = useCallback(
    (cardId) => quietCheckingExistence(cardId, () => deleteCardHook(cardId)),
    [quietCheckingExistence, deleteCardHook],
  )
  const previewClear = useCallback(async (projectKey) => {
    const { cards: count, imagens } = await previewClearFinished(projectKey)
    return { cards: count, imagens }
  }, [previewClearFinished])
  const executeClear = useCallback(async (projectKey) => {
    const { cards: count } = await quiet(() => clearFinished(projectKey))
    return { cards: count }
  }, [quiet, clearFinished])
  const uploadImage = useCallback((cardId, file) => quiet(() => uploadCardImage(cardId, file)), [quiet, uploadCardImage])
  const deleteImage = useCallback((cardId, imageId) => quiet(() => deleteCardImage(cardId, imageId)), [quiet, deleteCardImage])
  const answerQuestion = useCallback((cardId, questionId, text) => answerCardQuestion(cardId, questionId, text), [answerCardQuestion])
  const deleteQuestion = useCallback((cardId, questionId) => quiet(() => deleteCardQuestion(cardId, questionId)), [quiet, deleteCardQuestion])

  return {
    columns,
    cards,
    fetchedCards,
    doneSlug,
    loading,
    columnsError: columnsReadError && columns.length === 0 ? columnsReadError : null,
    cardsLoaded,
    cardsStale: Boolean(cardsReadError) && cardsLoaded,
    cardsError: cardsReadError && !cardsLoaded ? cardsReadError : null,
    refetchCards,
    mutationError,
    clearMutationError,
    refetchColumns,
    createColumn,
    renameColumn,
    deleteColumn,
    setDoneColumn,
    reorderColumns,
    moveCard,
    changeColumn,
    createCard,
    updateCard,
    deleteCard,
    previewClear,
    executeClear,
    uploadImage,
    deleteImage,
    answerQuestion,
    deleteQuestion,
    setCardDragActive,
    moveNotice,
    dismissMoveNotice,
    columnDeleteRefusal,
  }
}
