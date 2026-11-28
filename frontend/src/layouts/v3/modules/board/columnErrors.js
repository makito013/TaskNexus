// What the board says about a column the server refused. The refusal is told by the REASON the
// API puts on the error, never by its words: the text of the backend can change, the reason is data.

export const COLUMN_DELETE_REFUSALS = ['coluna_concluida', 'ultima_coluna', 'coluna_com_cards']

export const COLUMN_DELETE_REFUSAL_TEXT = {
  coluna_concluida: 'Essa é a coluna de concluídos. Marque outra como concluída antes de excluir.',
  ultima_coluna: 'O board precisa de pelo menos uma coluna.',
  coluna_com_cards: 'A coluna ainda tem cards. Mova ou exclua os cards primeiro.',
}

// Why "Excluir coluna" is already unavailable in the menu (the same two rules, known from the list).
export const COLUMN_DELETE_BLOCKED_TEXT = {
  done: 'Não dá para excluir a coluna de concluídos.',
  last: 'O board precisa de ao menos uma coluna.',
}

export function columnDeleteRefusal(error) {
  const reason = error && typeof error === 'object' ? error.reason : null
  return COLUMN_DELETE_REFUSALS.includes(reason) ? reason : null
}

// No network: `fetch` rejects with a TypeError whose text is the browser's English ("Failed to
// fetch", "Load failed"), so it is never shown as it came.
export const NO_CONNECTION_TEXT = 'Sem conexão com o servidor. Tente de novo.'

// The message of the server for a rename or a creation that was refused (a repeated or empty
// name), the sentence for a missing connection, or the fallback when there is nothing a person can
// read (an object turned into text).
export function columnErrorMessage(error, fallback) {
  if (error instanceof TypeError) return NO_CONNECTION_TEXT
  const message = error instanceof Error ? error.message.trim() : ''
  return message && message !== '[object Object]' ? message : fallback
}
