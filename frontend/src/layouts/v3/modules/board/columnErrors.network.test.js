import { describe, it, expect } from 'vitest'
import { columnErrorMessage } from './columnErrors.js'

// No network: fetch rejects with a TypeError whose text is the engine's English ("Failed to fetch",
// "Load failed" on Safari, "NetworkError when attempting to fetch resource." on Firefox).
describe('columnErrorMessage: no connection', () => {
  it.each([
    'Failed to fetch',
    'Load failed',
    'NetworkError when attempting to fetch resource.',
  ])('says it in pt-BR, whatever the engine wrote (%s)', (text) => {
    expect(columnErrorMessage(new TypeError(text), 'Não consegui criar a coluna. Tente de novo.'))
      .toBe('Sem conexão com o servidor. Tente de novo.')
  })

  it('keeps the sentence of the server for an ordinary Error', () => {
    expect(columnErrorMessage(new Error('Já existe uma coluna com esse nome.'), 'Falhou')).toBe('Já existe uma coluna com esse nome.')
  })
})
