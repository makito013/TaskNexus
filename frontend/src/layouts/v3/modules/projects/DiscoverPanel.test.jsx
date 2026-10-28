import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import DiscoverPanel from './DiscoverPanel.jsx'
import { makeFolder } from './folderRules.js'

afterEach(() => cleanup())

const REF = { project_id: 5, project_name: 'qa-a', workspace_id: 2, workspace_name: 'QA A', archived: false }
const ENTRIES = [
  { legacy_key: 'Pessoal/tn-sandbox', name: 'tn-sandbox', path: 'D:\\projetos\\Pessoal\\tn-sandbox', client_key: 'Pessoal', used_by: [], adoptable_into_workspace_id: null },
  { legacy_key: 'Pessoal/lab-voz', name: 'lab-voz', path: 'D:\\projetos\\Pessoal\\lab-voz', client_key: 'Pessoal', used_by: [], adoptable_into_workspace_id: 1 },
  { legacy_key: 'podesubir/ymci', name: 'ymci', path: 'D:\\projetos\\podesubir\\ymci', client_key: 'podesubir', used_by: [REF], adoptable_into_workspace_id: null },
  { legacy_key: 'Old/arch', name: 'arch', path: 'D:\\projetos\\Old\\arch', client_key: 'Old', used_by: [], adoptable_into_workspace_id: 9 },
]
const WORKSPACES = [
  { id: 1, name: 'Pessoal', archived: false },
  { id: 2, name: 'QA A', archived: false },
  { id: 9, name: 'Old', archived: true },
]
const READY = { status: 'ready', data: { root: 'D:\\projetos', scanned_in_ms: 3140, entries: ENTRIES } }

function setup(props = {}) {
  const onUse = vi.fn()
  const onClose = vi.fn()
  const onRetry = vi.fn()
  render(
    <DiscoverPanel
      discovery={READY}
      folders={[]}
      workspaceId={1}
      workspaces={WORKSPACES}
      onUse={onUse}
      onClose={onClose}
      onRetry={onRetry}
      {...props}
    />,
  )
  return { onUse, onClose, onRetry }
}

describe('DiscoverPanel', () => {
  it('is a labelled group with the header, one fieldset per client and a checkbox per folder', () => {
    setup()
    const group = screen.getByRole('group', { name: 'Mapa de pastas descobertas' })
    expect(within(group).getByText('Pastas descobertas')).toBeTruthy()
    expect(within(group).getByText('D:\\projetos · 4 pastas elegíveis · varredura de 3,1 s')).toBeTruthy()
    expect(within(group).getAllByRole('group').map((fieldset) => fieldset.querySelector('legend').textContent)).toEqual(['Pessoal', 'podesubir', 'Old'])
    expect(within(group).getAllByRole('checkbox')).toHaveLength(4)
    expect(within(group).getByRole('checkbox', { name: /lab-voz/ })).toBeTruthy()
  })

  it('says "1 pasta elegível" in the singular', () => {
    setup({ discovery: { ...READY, data: { ...READY.data, entries: [ENTRIES[0]] } } })
    expect(screen.getByText(/D:\\projetos · 1 pasta elegível · varredura de 3,1 s/)).toBeTruthy()
  })

  it('the search filters by name, path or client and says so when nothing matches', () => {
    setup()
    const search = screen.getByRole('textbox', { name: 'Buscar pasta' })
    fireEvent.change(search, { target: { value: 'LAB' } })
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    fireEvent.change(search, { target: { value: 'podesubir' } })
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getByText('Nenhuma pasta encontrada com esse nome.')).toBeTruthy()
  })

  it('the search also matches the path alone (not the name nor the client)', () => {
    setup()
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar pasta' }), { target: { value: 'projetos\\old' } })
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.getByRole('checkbox', { name: /arch/ })).toBeTruthy()
  })

  it('a folder already in the list is checked, disabled and says "já neste projeto"', () => {
    setup({ folders: [makeFolder({ path: 'd:/projetos/pessoal/tn-sandbox/', isPrimary: true })] })
    const box = screen.getByRole('checkbox', { name: /tn-sandbox/ })
    expect(box.disabled).toBe(true)
    expect(box.checked).toBe(true)
    expect(screen.getByText('já neste projeto')).toBeTruthy()
  })

  it('one chip per project already using the folder, with the exact words; the own project is left out', () => {
    setup({ ownProjectId: null })
    expect(screen.getByText('já está em QA A › qa-a')).toBeTruthy()
    cleanup()
    setup({ ownProjectId: 5 })
    expect(screen.queryByText('já está em QA A › qa-a')).toBeNull()
  })

  it('"mantém o histórico da V2" only where the folder is adoptable in the chosen workspace', () => {
    setup({ workspaceId: 1 })
    const chips = screen.getAllByText('mantém o histórico da V2')
    expect(chips).toHaveLength(1)
    expect(chips[0].closest('.v3-discover__entry').textContent).toContain('lab-voz')
    cleanup()
    setup({ workspaceId: 2 })
    expect(screen.queryByText('mantém o histórico da V2')).toBeNull()
  })

  it('never promises the V2 history when adoption cannot happen: edit mode, or the owner workspace is archived', () => {
    setup({ allowAdoption: false })
    expect(screen.queryByText('mantém o histórico da V2')).toBeNull()
    expect(screen.queryByText('workspace Old arquivado')).toBeNull()
    cleanup()
    // the folder whose V2 client is an ARCHIVED workspace: no promise, an explanation
    setup({ workspaceId: 9 })
    expect(within(screen.getByRole('checkbox', { name: /arch/ }).closest('.v3-discover__entry')).queryByText('mantém o histórico da V2')).toBeNull()
    expect(screen.getByText('workspace Old arquivado')).toBeTruthy()
  })

  it('"Usar selecionadas (0)" is aria-disabled, inert and described by the note', () => {
    const { onUse } = setup()
    const use = screen.getByRole('button', { name: 'Usar selecionadas (0)' })
    expect(use.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(use.getAttribute('aria-describedby')).textContent).toBe('Marque ao menos uma pasta.')
    fireEvent.click(use)
    expect(onUse).not.toHaveBeenCalled()
  })

  it('marking folders counts them and "Usar" hands the entries over in list order', () => {
    const { onUse } = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: /ymci/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /lab-voz/ }))
    const use = screen.getByRole('button', { name: 'Usar selecionadas (2)' })
    expect(use.hasAttribute('aria-disabled')).toBe(false)
    expect(screen.queryByText('Marque ao menos uma pasta.')).toBeNull()
    fireEvent.click(use)
    expect(onUse).toHaveBeenCalledTimes(1)
    expect(onUse.mock.calls[0][0].map((entry) => entry.legacy_key)).toEqual(['Pessoal/lab-voz', 'podesubir/ymci'])
  })

  it('marking a folder used elsewhere is allowed: the note says it only warns', () => {
    const { onUse } = setup()
    expect(screen.getByText('Marcar uma pasta já usada não bloqueia: ela só avisa onde está.')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /ymci/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Usar selecionadas (1)' }))
    expect(onUse.mock.calls[0][0]).toHaveLength(1)
  })

  it('unmarking returns to zero', () => {
    setup()
    const box = screen.getByRole('checkbox', { name: /lab-voz/ })
    fireEvent.click(box)
    fireEvent.click(box)
    expect(screen.getByRole('button', { name: 'Usar selecionadas (0)' })).toBeTruthy()
  })

  it('"Fechar mapa" closes', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar mapa' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows a loading status, and an alert with a retry when the scan fails', () => {
    setup({ discovery: { status: 'loading' } })
    expect(screen.getByRole('status').textContent).toBe('Procurando as pastas…')
    cleanup()
    const { onRetry } = setup({ discovery: { status: 'error', error: new Error('boom') } })
    expect(screen.getByRole('alert').textContent).toContain('Não consegui varrer as pastas. Nada foi alterado.')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
