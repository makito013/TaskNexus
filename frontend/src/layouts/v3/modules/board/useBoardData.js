import { useCallback, useMemo, useState } from 'react'
import { useCards } from '../../../../hooks/useCards.js'
import { useColumns } from '../../../../hooks/useColumns.js'

// The one place of the V3 board that talks to the board hooks (boardWriteGuard
// keeps every other file of this folder away from them). It composes the shared
// card and column hooks of the V2 with the options that make them quiet: a
// failed mutation becomes `mutationError` here instead of a blocking alert(),
// and the card poll pauses while the tab is hidden.
//
// This phase only reads. The columns are global; the cards are the ones of the
// scope (`scope.fetchIds` narrows the request, `scope.matches` keeps what the
// header filters ask for, such as the archived switch).
//
//   loading        the columns have not answered yet
//   columnsError   the columns could not be read and there is nothing to show
//   cardsLoaded    the first read of the current request answered
//   cardsStale     a later read failed: what is shown is the last good state
//   cardsError     the read of the CURRENT filter failed and none has worked yet for it
//                  (first read, or a change of project during an outage); it goes away only
//                  when a read works
//   refetchCards   reads again now
//   fetchedCards   every card the request returned, before the scope's filter
export function useBoardData({ scope }) {
  const [mutationError, setMutationError] = useState(null)
  const clearMutationError = useCallback(() => setMutationError(null), [])
  const handleMutationError = useCallback((message) => setMutationError({ message }), [])

  const {
    columns,
    loading,
    readError: columnsReadError,
    refetch: refetchColumns,
    doneSlug,
  } = useColumns()

  const {
    cards: fetchedCards,
    loaded: cardsLoaded,
    readError: cardsReadError,
    refetch: refetchCards,
  } = useCards(
    scope.fetchIds,
    doneSlug,
    { onMutationError: handleMutationError, pauseWhenHidden: true, trackReadState: true },
  )

  const cards = useMemo(
    () => fetchedCards.filter((card) => scope.matches(card.projeto_id)),
    [fetchedCards, scope],
  )

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
  }
}
