import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import FolderList from './FolderList.jsx'
import { LOCKED_MISSING_HINT, makeFolder } from './folderRules.js'

afterEach(() => cleanup())

const row = (path, extra = {}) => makeFolder({ path, ...extra })

function setup(folders, props = {}) {
  const onPrimaryChange = vi.fn()
  const onRemove = vi.fn()
  render(
    <div>
      <span id="folders-lbl">Pastas</span>
      <span id="lock-note">A pasta principal está travada.</span>
      <FolderList folders={folders} onPrimaryChange={onPrimaryChange} onRemove={onRemove} {...props} />
    </div>,
  )
  return { onPrimaryChange, onRemove }
}

describe('FolderList', () => {
  it('is a radiogroup labelled by "Pastas" with one native radio per row, only one checked', () => {
    setup([row('D:\\a', { isPrimary: true }), row('D:\\b')])
    const group = screen.getByRole('radiogroup', { name: 'Pastas' })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(radios.map((radio) => radio.checked)).toEqual([true, false])
    expect(new Set(radios.map((radio) => radio.name))).toEqual(new Set(['primary']))
    expect(radios[1].getAttribute('aria-describedby')).toBe('fp-1')
    expect(document.getElementById('fp-1').textContent).toBe('D:\\b')
  })

  it('changing the radio reports the row index', () => {
    const { onPrimaryChange } = setup([row('D:\\a', { isPrimary: true }), row('D:\\b')])
    fireEvent.click(screen.getAllByRole('radio')[1])
    expect(onPrimaryChange).toHaveBeenCalledWith(1)
  })

  it('"Remover" is named by the path and removes the row', () => {
    const { onRemove } = setup([row('D:\\a', { isPrimary: true }), row('D:\\b')])
    fireEvent.click(screen.getByRole('button', { name: 'Remover pasta D:\\b' }))
    expect(onRemove).toHaveBeenCalledWith(1)
  })

  it('a locked primary: chip "travada", its Remover is aria-disabled and inert, the other radios are disabled', () => {
    const { onRemove } = setup([row('D:\\locked', { isPrimary: true, locked: true }), row('D:\\extra')])
    expect(screen.getByText('travada')).toBeTruthy()
    const remove = screen.getByRole('button', { name: 'Remover pasta D:\\locked' })
    expect(remove.getAttribute('aria-disabled')).toBe('true')
    expect(remove.getAttribute('aria-describedby')).toBe('lock-note')
    fireEvent.click(remove)
    expect(onRemove).not.toHaveBeenCalled()
    const [lockedRadio, otherRadio] = screen.getAllByRole('radio')
    expect(lockedRadio.checked).toBe(true)
    expect(lockedRadio.getAttribute('aria-disabled')).toBe('true')
    expect(lockedRadio.getAttribute('aria-describedby')).toBe('fp-0 lock-note')
    expect(otherRadio.disabled).toBe(true)
    // the extra row stays removable
    fireEvent.click(screen.getByRole('button', { name: 'Remover pasta D:\\extra' }))
    expect(onRemove).toHaveBeenCalledWith(1)
  })

  it('without a locked row nothing is disabled', () => {
    setup([row('D:\\a', { isPrimary: true }), row('D:\\b')])
    expect(screen.getAllByRole('radio').every((radio) => !radio.disabled)).toBe(true)
    expect(screen.queryByText('travada')).toBeNull()
  })

  it('shows each error as an alert with the server code, and a row with an error cannot become the primary', () => {
    const bad = { ...row('D:\\gone'), check: { errors: [{ code: 'not_found', message: 'A pasta não existe nesta máquina.' }], warns: [], infos: [], canonical: null } }
    setup([row('D:\\a', { isPrimary: true }), bad])
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Erro: A pasta não existe nesta máquina.')
    expect(alert.getAttribute('data-code')).toBe('not_found')
    expect(screen.getAllByRole('radio')[1].disabled).toBe(true)
  })

  it('shows server problems kept on the row the same way', () => {
    const rejected = { ...row('D:\\a', { isPrimary: true }), serverProblems: [{ code: 'sensitive_folder', message: 'Pasta de chaves ou credenciais. Não pode ser pasta de projeto.' }] }
    setup([rejected])
    expect(screen.getByRole('alert').textContent).toContain('Pasta de chaves ou credenciais. Não pode ser pasta de projeto.')
  })

  it('shows the warnings as chips with the exact words and does not call them errors', () => {
    const warned = {
      ...row('D:\\a', { isPrimary: true }),
      check: {
        errors: [],
        warns: [{ code: 'already_used', text: 'já está em QA A › qa-a' }, { code: 'nested', text: 'dentro de QA A › qa-a (pastas sobrepostas)' }],
        infos: [],
        canonical: null,
      },
    }
    setup([warned])
    expect(screen.getByText('já está em QA A › qa-a')).toBeTruthy()
    expect(screen.getByText('dentro de QA A › qa-a (pastas sobrepostas)')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('radio').disabled).toBe(false)
  })

  it('says "mantém o histórico da V2" only on the PRIMARY row of a folder adoptable in the chosen workspace', () => {
    const folders = [
      row('D:\\legacy', { isPrimary: true, adoptableWorkspaceId: 4 }),
      row('D:\\extra-legacy', { adoptableWorkspaceId: 4 }),
    ]
    setup(folders, { adoptableFor: 4 })
    expect(screen.getAllByText('mantém o histórico da V2')).toHaveLength(1)
    cleanup()
    setup(folders, { adoptableFor: 9 })
    expect(screen.queryByText('mantém o histórico da V2')).toBeNull()
    cleanup()
    setup(folders, { adoptableFor: null })
    expect(screen.queryByText('mantém o histórico da V2')).toBeNull()
  })

  it('marks a saved row whose folder is gone, and explains the locked one', () => {
    setup([
      row('D:\\gone', { isPrimary: true, locked: true, saved: true, exists: false }),
      row('D:\\gone-extra', { saved: true, exists: false }),
      row('D:\\fine', { saved: true }),
    ])
    expect(screen.getAllByText('pasta não encontrada')).toHaveLength(2)
    expect(screen.getByText(LOCKED_MISSING_HINT)).toBeTruthy()
  })

  it('does not mark a typed (unsaved) row as missing', () => {
    setup([row('D:\\typed', { isPrimary: true, exists: false })])
    expect(screen.queryByText('pasta não encontrada')).toBeNull()
  })
})
