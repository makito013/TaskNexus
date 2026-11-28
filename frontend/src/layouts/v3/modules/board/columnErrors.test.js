import { describe, it, expect } from 'vitest'
import {
  COLUMN_DELETE_REFUSAL_TEXT,
  columnDeleteRefusal,
  columnErrorMessage,
} from './columnErrors.js'

const refused = (reason, message = 'texto qualquer') => Object.assign(new Error(message), { reason })

describe('columnDeleteRefusal', () => {
  it.each(['coluna_concluida', 'ultima_coluna', 'coluna_com_cards'])('knows the refusal %s by its reason', (reason) => {
    expect(columnDeleteRefusal(refused(reason))).toBe(reason)
  })

  it('reads the reason only: the same words in the message mean nothing', () => {
    expect(columnDeleteRefusal(new Error('coluna_concluida'))).toBeNull()
    expect(columnDeleteRefusal(refused(null, 'A coluna ainda tem cards'))).toBeNull()
    expect(columnDeleteRefusal(refused('outra_coisa'))).toBeNull()
  })

  it('is not fooled by a missing error', () => {
    expect(columnDeleteRefusal(undefined)).toBeNull()
    expect(columnDeleteRefusal(null)).toBeNull()
  })

  it('has a text in pt-BR for each refusal', () => {
    expect(COLUMN_DELETE_REFUSAL_TEXT).toEqual({
      coluna_concluida: 'Essa é a coluna de concluídos. Marque outra como concluída antes de excluir.',
      ultima_coluna: 'O board precisa de pelo menos uma coluna.',
      coluna_com_cards: 'A coluna ainda tem cards. Mova ou exclua os cards primeiro.',
    })
  })
})

describe('columnErrorMessage', () => {
  it('hands out the message of the server when it is a sentence', () => {
    expect(columnErrorMessage(new Error('Já existe uma coluna com esse nome.'), 'Falhou')).toBe('Já existe uma coluna com esse nome.')
  })

  it.each([
    ['an empty message', new Error('')],
    ['an object stringified by accident', new Error('[object Object]')],
    ['a missing error', undefined],
    ['something that is not an error', 'oops'],
  ])('falls back for %s', (_label, error) => {
    expect(columnErrorMessage(error, 'Falhou')).toBe('Falhou')
  })
})
