import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup, act } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import { LOCK_TEXT, LOCKED_MISSING_HINT } from './folderRules.js'
import ProjectDialog from './ProjectDialog.jsx'
import { buildRegistryIndex } from './registryIndex.js'

installDialogElementStub()
afterEach(() => cleanup())

const folder = (id, path, extra = {}) => ({ id, path, is_primary: true, position: 0, exists: true, ...extra })
const REGISTRY = buildRegistryIndex({
  seeded: null,
  workspaces: [
    {
      id: 1, key: 'Pessoal', name: 'Pessoal', origin: 'seed', archived: false,
      projects: [
        {
          id: 10, key: 'Pessoal/tn-sandbox', name: 'tn-sandbox', origin: 'seed', archived: false, primary_locked: true,
          folders: [
            folder(100, 'D:\\projetos\\Pessoal\\tn-sandbox'),
            folder(101, 'D:\\extras\\shared', { is_primary: false, position: 1 }),
          ],
        },
        { id: 11, key: 'Pessoal/.p11', name: 'qa-a', origin: 'user', archived: false, primary_locked: false, folders: [folder(110, 'C:\\qa\\a')] },
        { id: 12, key: 'Pessoal/old', name: 'old', origin: 'seed', archived: true, primary_locked: true, folders: [folder(120, 'D:\\projetos\\Pessoal\\old')] },
      ],
    },
    { id: 2, key: '.w2', name: 'QA A', origin: 'user', archived: false, projects: [] },
    { id: 3, key: 'Old', name: 'Old', origin: 'seed', archived: true, projects: [] },
  ],
})
const WORKSPACES = REGISTRY.workspaces
const projectByKey = (key) => REGISTRY.projectByKey.get(key)

const okResult = (path, extra = {}) => ({
  input: path, path, ok: true, problems: [], used_by: [], in_this_project: false, nested_in: [], has_marker: false, ...extra,
})
const REF = { project_id: 11, project_name: 'qa-a', workspace_id: 2, workspace_name: 'QA A', archived: false }
const DISCOVER = {
  root: 'D:\\projetos',
  scanned_in_ms: 3100,
  entries: [
    { legacy_key: 'Pessoal/lab-voz', name: 'lab-voz', path: 'D:\\projetos\\Pessoal\\lab-voz', client_key: 'Pessoal', used_by: [], adoptable_into_workspace_id: 1 },
    { legacy_key: 'podesubir/ymci', name: 'ymci', path: 'D:\\projetos\\podesubir\\ymci', client_key: 'podesubir', used_by: [REF], adoptable_into_workspace_id: null },
    { legacy_key: 'podesubir/api', name: 'api', path: 'D:\\projetos\\podesubir\\api', client_key: 'podesubir', used_by: [], adoptable_into_workspace_id: null },
  ],
}

function makeMutations(overrides = {}) {
  return {
    createWorkspace: vi.fn(async (input) => ({ workspace: { id: 99, key: '.w99', name: input.name } })),
    updateWorkspace: vi.fn(),
    createProject: vi.fn(async () => ({ project: { id: 50 }, warnings: [] })),
    updateProject: vi.fn(async () => ({ project: { id: 10 }, warnings: [] })),
    inspectFolders: vi.fn(async ({ paths }) => ({ results: paths.map((path) => okResult(path)) })),
    discoverFolders: vi.fn(async () => DISCOVER),
    browseFolder: vi.fn(async () => ({ path: null })),
    pending: false,
    error: null,
    ...overrides,
  }
}

function open(props = {}) {
  const mutations = props.mutations || makeMutations()
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const utils = render(
    <ProjectDialog
      mode="create"
      workspaces={WORKSPACES}
      workspaceId={2}
      {...props}
      mutations={mutations}
      onClose={onClose}
      onSaved={onSaved}
    />,
  )
  return { mutations, onClose, onSaved, ...utils }
}

const nameField = () => screen.getByLabelText('Nome do projeto')
const addField = () => screen.getByLabelText('Adicionar pasta')
const save = (name = 'Adicionar projeto') => screen.getByRole('button', { name })

async function addTyped(path) {
  fireEvent.change(addField(), { target: { value: path } })
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
  await screen.findByText(path, { selector: '.v3-folder__path' })
}

describe('ProjectDialog: the form', () => {
  it('shows the plan copy and starts on the name field', () => {
    open()
    expect(screen.getByRole('heading', { name: 'Adicionar projeto' })).toBeTruthy()
    expect(document.activeElement).toBe(nameField())
    expect(nameField().getAttribute('placeholder')).toBe('Ex.: ymci-docs')
    expect(screen.getByText('Se ficar vazio, sugerimos o nome da primeira pasta.')).toBeTruthy()
    expect(screen.getByText('Escolha onde o projeto aparece na tela.')).toBeTruthy()
    expect(screen.getByText('A pasta principal é onde os agentes abrem. As outras ficam acessíveis como pastas adicionais.')).toBeTruthy()
    expect(screen.getByText('Nenhuma pasta ainda. Digite um caminho, use Procurar ou Analisar automático.')).toBeTruthy()
    expect(addField().getAttribute('placeholder')).toBe('D:\\projetos\\meu-app')
    expect(screen.getByText('Remover um projeto ou pasta daqui não apaga nada no disco.')).toBeTruthy()
    expect(screen.getByText(/abre o seletor de pastas do computador onde o servidor roda/)).toBeTruthy()
    for (const label of ['Procurar…', 'Adicionar', 'Analisar automático', 'Cancelar', 'Adicionar projeto']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('the origin "Clonar repositório" and "Só terminal" are focusable, inert and described by the note', () => {
    open()
    const group = screen.getByRole('radiogroup', { name: 'Origem' })
    const [local, clone, terminal] = within(group).getAllByRole('radio')
    expect(local.getAttribute('aria-checked')).toBe('true')
    for (const option of [clone, terminal]) {
      expect(option.getAttribute('aria-disabled')).toBe('true')
      expect(option.disabled).toBe(false)
      expect(document.getElementById(option.getAttribute('aria-describedby')).textContent)
        .toBe('Clonar repositório e Só terminal chegam depois. Por enquanto, o projeto aponta para pastas que já existem.')
      option.focus()
      expect(document.activeElement).toBe(option)
      fireEvent.click(option)
      expect(option.getAttribute('aria-checked')).toBe('false')
    }
    expect(local.getAttribute('aria-checked')).toBe('true')
    expect(within(clone).getByText('em breve')).toBeTruthy()
  })

  it('lists only the ACTIVE workspaces, preselects the given one and ends with "+ Novo workspace…"', () => {
    open({ workspaceId: 2 })
    const select = screen.getByLabelText('Workspace')
    expect([...select.options].map((option) => option.textContent)).toEqual(['Pessoal', 'QA A', '+ Novo workspace…'])
    expect(select.value).toBe('2')
  })

  it('falls back to the first active workspace when the given one is archived', () => {
    open({ workspaceId: 3 })
    expect(screen.getByLabelText('Workspace').value).toBe('1')
  })
})

describe('ProjectDialog: adding folders', () => {
  it('a typed folder is inspected and added; the first becomes the primary and fills the name', async () => {
    const { mutations } = open()
    await addTyped('D:\\projetos\\ymci-docs')
    expect(mutations.inspectFolders).toHaveBeenCalledWith({ paths: ['D:\\projetos\\ymci-docs'], excludeProjectId: null })
    expect(screen.getByRole('radio', { name: 'Principal' }).checked).toBe(true)
    expect(nameField().value).toBe('ymci-docs')
    expect(addField().value).toBe('')
  })

  it('does not overwrite a name the user typed', async () => {
    open()
    fireEvent.change(nameField(), { target: { value: 'meu nome' } })
    await addTyped('D:\\projetos\\ymci-docs')
    expect(nameField().value).toBe('meu nome')
  })

  it('the second folder is not primary; the radio moves the mark and the Remover hands it on', async () => {
    open()
    await addTyped('D:\\a')
    await addTyped('D:\\b')
    let radios = screen.getAllByRole('radio', { name: 'Principal' })
    expect(radios.map((radio) => radio.checked)).toEqual([true, false])
    fireEvent.click(radios[1])
    radios = screen.getAllByRole('radio', { name: 'Principal' })
    expect(radios.map((radio) => radio.checked)).toEqual([false, true])
    fireEvent.click(screen.getByRole('button', { name: 'Remover pasta D:\\b' }))
    radios = screen.getAllByRole('radio', { name: 'Principal' })
    expect(radios.map((radio) => radio.checked)).toEqual([true])
  })

  it('a folder used by another project shows "já está em QA A › qa-a" and does NOT block the add', async () => {
    const inspectFolders = vi.fn(async ({ paths }) => ({ results: paths.map((path) => okResult(path, { used_by: [REF] })) }))
    open({ mutations: makeMutations({ inspectFolders }) })
    await addTyped('C:\\qa\\a')
    expect(screen.getAllByText('já está em QA A › qa-a').length).toBeGreaterThan(0)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('words both "nested" relations exactly', async () => {
    const inspectFolders = vi.fn(async ({ paths }) => ({
      results: paths.map((path) => okResult(path, {
        nested_in: [{ ...REF, relation: 'inside' }, { ...REF, project_name: 'qa-b', relation: 'contains' }],
      })),
    }))
    open({ mutations: makeMutations({ inspectFolders }) })
    await addTyped('C:\\qa\\a\\sub')
    expect(screen.getAllByText('dentro de QA A › qa-a (pastas sobrepostas)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('contém QA A › qa-b (pastas sobrepostas)').length).toBeGreaterThan(0)
  })

  it('a refused folder shows the server message and is not added', async () => {
    const inspectFolders = vi.fn(async ({ paths }) => ({
      results: paths.map((path) => ({
        input: path, path: null, ok: false, used_by: [], in_this_project: false, nested_in: [], has_marker: false,
        problems: [{ code: 'system_folder', message: 'Pasta do sistema não pode ser pasta de projeto.' }],
      })),
    }))
    open({ mutations: makeMutations({ inspectFolders }) })
    fireEvent.change(addField(), { target: { value: 'C:\\Windows\\System32' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Erro: Pasta do sistema não pode ser pasta de projeto.')
    expect(addField().getAttribute('aria-invalid')).toBe('true')
    expect(screen.queryByRole('radiogroup', { name: 'Pastas' })).toBeNull()
    expect(screen.getByText('Nenhuma pasta ainda. Digite um caminho, use Procurar ou Analisar automático.')).toBeTruthy()
  })

  it('asks the server ONCE when the field is left and "Adicionar" is clicked for the same text', async () => {
    const { mutations } = open()
    fireEvent.change(addField(), { target: { value: 'D:/once' } })
    fireEvent.blur(addField())
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    await screen.findByText('D:/once', { selector: '.v3-folder__path' })
    expect(mutations.inspectFolders).toHaveBeenCalledTimes(1)
  })

  it('a second click on the same text after a refusal asks again (the folder may have been fixed)', async () => {
    const inspectFolders = vi.fn()
      .mockResolvedValueOnce({ results: [{ input: 'D:/fix', path: null, ok: false, problems: [{ code: 'not_found', message: 'A pasta não existe nesta máquina.' }], used_by: [], nested_in: [] }] })
      .mockResolvedValue({ results: [okResult('D:/fix')] })
    open({ mutations: makeMutations({ inspectFolders }) })
    fireEvent.change(addField(), { target: { value: 'D:/fix' } })
    fireEvent.blur(addField())
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' })) // reuses the refusal of the blur
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Pastas' })).toBeNull())
    expect(inspectFolders).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' })) // asks again
    await screen.findByText('D:/fix', { selector: '.v3-folder__path' })
    expect(inspectFolders).toHaveBeenCalledTimes(2)
  })

  it('reusing the blur result still refuses a folder that became a duplicate meanwhile', async () => {
    const { mutations } = open({ workspaceId: 1 })
    const lab = DISCOVER.entries[0].path
    fireEvent.change(addField(), { target: { value: lab } })
    fireEvent.blur(addField())
    await waitFor(() => expect(mutations.inspectFolders).toHaveBeenCalledTimes(1))
    // the same folder arrives through the map while the text is still in the field
    fireEvent.click(screen.getByRole('button', { name: 'Analisar automático' }))
    await screen.findByRole('group', { name: 'Mapa de pastas descobertas' })
    fireEvent.click(screen.getByRole('checkbox', { name: /lab-voz/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Usar selecionadas (1)' }))
    await screen.findByText(lab, { selector: '.v3-folder__path' })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    await waitFor(() => expect(screen.getAllByRole('alert').some((a) => a.textContent.includes('Esta pasta já está neste projeto.'))).toBe(true))
    expect(screen.getAllByRole('radio', { name: 'Principal' })).toHaveLength(1)
  })

  it('inspects the typed path when the field loses focus, without adding it', async () => {
    const { mutations } = open()
    fireEvent.change(addField(), { target: { value: 'D:\\typed' } })
    fireEvent.blur(addField())
    await waitFor(() => expect(mutations.inspectFolders).toHaveBeenCalledTimes(1))
    expect(mutations.inspectFolders).toHaveBeenCalledWith({ paths: ['D:\\typed'], excludeProjectId: null })
    expect(screen.queryByRole('radiogroup', { name: 'Pastas' })).toBeNull()
    expect(addField().value).toBe('D:\\typed')
  })

  it('does not inspect on blur when the field is empty', () => {
    const { mutations } = open()
    fireEvent.blur(addField())
    expect(mutations.inspectFolders).not.toHaveBeenCalled()
  })

  it('an empty "Adicionar" asks for a path; a repeated folder is refused; more than 10 are refused', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Informe um caminho.')
    await addTyped('D:\\a')
    fireEvent.change(addField(), { target: { value: 'd:/a/' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    await waitFor(() => expect(screen.getAllByRole('alert').some((alert) => alert.textContent.includes('Esta pasta já está neste projeto.'))).toBe(true))
    expect(screen.getAllByRole('radio', { name: 'Principal' })).toHaveLength(1)
    for (let index = 0; index < 9; index += 1) await addTyped(`D:\\f${index}`)
    fireEvent.change(addField(), { target: { value: 'D:\\one-too-many' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    await waitFor(() => expect(screen.getAllByRole('alert').some((alert) => alert.textContent.includes('Um projeto pode ter no máximo 10 pastas.'))).toBe(true))
    expect(screen.getAllByRole('radio', { name: 'Principal' })).toHaveLength(10)
  })

  it('Enter in the field adds the folder (and does not submit the dialog)', async () => {
    const { mutations } = open()
    fireEvent.change(addField(), { target: { value: 'D:\\by-enter' } })
    fireEvent.keyDown(addField(), { key: 'Enter' })
    await screen.findByText('D:\\by-enter', { selector: '.v3-folder__path' })
    expect(mutations.createProject).not.toHaveBeenCalled()
  })
})

describe('ProjectDialog: "Procurar…"', () => {
  it('puts the picked path in the field and inspects it', async () => {
    const browseFolder = vi.fn(async () => ({ path: 'D:\\picked\\app' }))
    const { mutations } = open({ mutations: makeMutations({ browseFolder }) })
    fireEvent.click(screen.getByRole('button', { name: 'Procurar…' }))
    await waitFor(() => expect(addField().value).toBe('D:\\picked\\app'))
    await waitFor(() => expect(mutations.inspectFolders).toHaveBeenCalledWith({ paths: ['D:\\picked\\app'], excludeProjectId: null }))
  })

  it('a cancelled picker changes nothing; a failing one says so', async () => {
    const { mutations } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Procurar…' }))
    await waitFor(() => expect(mutations.browseFolder).toHaveBeenCalledTimes(1))
    expect(addField().value).toBe('')
    expect(mutations.inspectFolders).not.toHaveBeenCalled()
    cleanup()

    const failing = makeMutations({ browseFolder: vi.fn().mockRejectedValue(new Error('500')) })
    open({ mutations: failing })
    fireEvent.click(screen.getByRole('button', { name: 'Procurar…' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Não consegui abrir o seletor de pastas. Digite o caminho.')
  })
})

describe('ProjectDialog: saving a new project', () => {
  it('blocks with the exact reasons, announces them through aria-describedby and unblocks as they are fixed', async () => {
    const { mutations } = open()
    fireEvent.click(save())
    expect(mutations.createProject).not.toHaveBeenCalled()
    let why = screen.getByRole('alert')
    expect(why.textContent).toBe('Informe o nome do projeto.')
    expect(save().getAttribute('aria-disabled')).toBe('true')
    expect(save().getAttribute('aria-describedby')).toBe(why.id)
    expect(nameField().getAttribute('aria-invalid')).toBe('true')

    fireEvent.change(nameField(), { target: { value: 'qa-a' } })
    why = screen.getByRole('alert')
    expect(why.textContent).toBe('Adicione ao menos uma pasta.')
    expect(save().getAttribute('aria-describedby')).toBe(why.id)

    await addTyped('D:\\a')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(save().hasAttribute('aria-disabled')).toBe(false)
  })

  it('creates with the typed name, the workspace and the folders (primary flag in the payload)', async () => {
    const { mutations, onClose, onSaved } = open()
    fireEvent.change(nameField(), { target: { value: '  qa-a  ' } })
    await addTyped('C:\\tmp\\a')
    await addTyped('C:\\tmp\\b')
    fireEvent.click(save())
    await waitFor(() => expect(mutations.createProject).toHaveBeenCalledTimes(1))
    expect(mutations.createProject).toHaveBeenCalledWith(2, {
      name: 'qa-a',
      folders: [{ path: 'C:\\tmp\\a', isPrimary: true }, { path: 'C:\\tmp\\b', isPrimary: false }],
    })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSaved).toHaveBeenCalledWith({ id: 50 })
  })

  it('inspects every row again before saving and does not create when one went bad', async () => {
    const calls = []
    const inspectFolders = vi.fn(async ({ paths }) => {
      calls.push(paths)
      const refuse = calls.length > 2
      return {
        results: paths.map((path) => (refuse
          ? { input: path, path: null, ok: false, used_by: [], in_this_project: false, nested_in: [], has_marker: false, problems: [{ code: 'not_found', message: 'A pasta não existe nesta máquina.' }] }
          : okResult(path))),
      }
    })
    const { mutations } = open({ mutations: makeMutations({ inspectFolders }) })
    fireEvent.change(nameField(), { target: { value: 'qa-a' } })
    await addTyped('C:\\a')
    await addTyped('C:\\b')
    fireEvent.click(save())
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(calls.at(-1)).toEqual(['C:\\a', 'C:\\b'])
    expect(mutations.createProject).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent).join('|')).toContain('Corrija ou remova as pastas com erro para salvar.')
  })

  it('maps a 400 with problems onto the row named by the path, leaving the other row clean', async () => {
    const failure = Object.assign(new Error('A pasta não existe nesta máquina.'), {
      status: 400,
      problems: [{ path: 'C:\\b', code: 'not_found', message: 'A pasta não existe nesta máquina.' }],
    })
    const { mutations, onClose } = open({ mutations: makeMutations({ createProject: vi.fn().mockRejectedValue(failure) }) })
    fireEvent.change(nameField(), { target: { value: 'qa-a' } })
    await addTyped('C:\\a')
    await addTyped('C:\\b')
    fireEvent.click(save())
    const rowB = (await screen.findByText('C:\\b', { selector: '.v3-folder__path' })).closest('li')
    await waitFor(() => expect(within(rowB).getByRole('alert').textContent).toBe('Erro: A pasta não existe nesta máquina.'))
    const rowA = screen.getByText('C:\\a', { selector: '.v3-folder__path' }).closest('li')
    expect(within(rowA).queryByRole('alert')).toBeNull()
    expect(screen.getByText('Corrija ou remova as pastas com erro para salvar.')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(mutations.createProject).toHaveBeenCalledTimes(1)
  })

  it('a 400 on the name lands on the name field', async () => {
    const failure = Object.assign(new Error('x'), {
      status: 400, problems: [{ path: null, code: 'invalid_name', message: 'Informe um nome com 1 a 80 caracteres.' }],
    })
    open({ mutations: makeMutations({ createProject: vi.fn().mockRejectedValue(failure) }) })
    fireEvent.change(nameField(), { target: { value: 'qa-a' } })
    await addTyped('C:\\a')
    fireEvent.click(save())
    await waitFor(() => expect(nameField().getAttribute('aria-invalid')).toBe('true'))
    expect(document.getElementById(nameField().getAttribute('aria-describedby')).textContent).toBe('Informe um nome com 1 a 80 caracteres.')
  })

  it('a 409 adopt_conflict says the project exists archived', async () => {
    const failure = Object.assign(new Error('server'), { status: 409, code: 'adopt_conflict' })
    open({ mutations: makeMutations({ createProject: vi.fn().mockRejectedValue(failure) }) })
    fireEvent.change(nameField(), { target: { value: 'lab-voz' } })
    await addTyped('D:\\projetos\\Pessoal\\lab-voz')
    fireEvent.click(save())
    expect((await screen.findByRole('alert')).textContent).toBe('Esse projeto já existe arquivado. Desarquive-o em "Mostrar arquivados".')
  })

  it('a network failure shows the generic line and lets the user try again', async () => {
    const createProject = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({ project: { id: 7 } })
    const { onClose } = open({ mutations: makeMutations({ createProject }) })
    fireEvent.change(nameField(), { target: { value: 'qa-a' } })
    await addTyped('C:\\a')
    fireEvent.click(save())
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível concluir agora. Nada foi alterado.')
    fireEvent.click(save())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(createProject).toHaveBeenCalledTimes(2)
  })

  it('shows "Salvando…" as busy and sends one request for two clicks', async () => {
    let finish
    const createProject = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    const { onSaved } = open({ mutations: makeMutations({ createProject }) })
    fireEvent.change(nameField(), { target: { value: 'qa-a' } })
    await addTyped('C:\\a')
    fireEvent.click(save())
    const busy = await screen.findByRole('button', { name: 'Salvando…' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(busy)
    await act(async () => { finish({ project: { id: 1 } }) })
    expect(createProject).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalled()
  })

  it('warns about a homonym in the workspace without blocking', async () => {
    const { mutations } = open({ workspaceId: 1 })
    fireEvent.change(nameField(), { target: { value: 'QA-A' } })
    expect(screen.getByText('já existe um projeto com este nome neste workspace')).toBeTruthy()
    await addTyped('C:\\other')
    fireEvent.click(save())
    await waitFor(() => expect(mutations.createProject).toHaveBeenCalled())
  })
})

describe('ProjectDialog: "+ Novo workspace…"', () => {
  it('opens a second dialog on top, selects the new workspace and hands the focus back to the select', async () => {
    const { mutations } = open({ workspaceId: 1 })
    const select = screen.getByLabelText('Workspace')
    fireEvent.change(select, { target: { value: '__new' } })
    expect(select.value).toBe('1') // controlled: stays on the previous workspace
    const dialogs = document.querySelectorAll('dialog[open]')
    expect(dialogs).toHaveLength(2)
    const second = screen.getByRole('heading', { name: 'Novo workspace' }).closest('dialog')
    fireEvent.change(within(second).getByLabelText('Nome do workspace'), { target: { value: 'Estudos' } })
    fireEvent.click(within(second).getByRole('button', { name: 'Criar workspace' }))
    await waitFor(() => expect(document.querySelectorAll('dialog[open]')).toHaveLength(1))
    expect(mutations.createWorkspace).toHaveBeenCalledWith({ name: 'Estudos', adoptLegacyKey: null })
    expect(select.value).toBe('99')
    expect([...select.options].map((option) => option.textContent)).toContain('Estudos')
    expect(document.activeElement).toBe(select)
  })

  it('cancelling it leaves the select on the previous workspace and keeps the form', async () => {
    open({ workspaceId: 1 })
    fireEvent.change(nameField(), { target: { value: 'draft' } })
    const select = screen.getByLabelText('Workspace')
    fireEvent.change(select, { target: { value: '__new' } })
    fireEvent.keyDown(screen.getByLabelText('Nome do workspace'), { key: 'Escape' })
    await waitFor(() => expect(document.querySelectorAll('dialog[open]')).toHaveLength(1))
    expect(select.value).toBe('1')
    expect(nameField().value).toBe('draft')
    expect(document.activeElement).toBe(select)
  })
})

describe('ProjectDialog: "Analisar automático"', () => {
  it('opens the map (aria-expanded), loads it once and closes it again', async () => {
    const { mutations } = open({ workspaceId: 1 })
    const toggle = screen.getByRole('button', { name: 'Analisar automático' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    await screen.findByRole('group', { name: 'Mapa de pastas descobertas' })
    expect(mutations.discoverFolders).toHaveBeenCalledTimes(1)
    fireEvent.click(toggle)
    expect(screen.queryByRole('group', { name: 'Mapa de pastas descobertas' })).toBeNull()
    fireEvent.click(toggle)
    await screen.findByRole('group', { name: 'Mapa de pastas descobertas' })
    expect(mutations.discoverFolders).toHaveBeenCalledTimes(1)
  })

  it('"Usar selecionadas" adds the folders, makes the first the primary, suggests the name and closes the map', async () => {
    const { mutations } = open({ workspaceId: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Analisar automático' }))
    await screen.findByRole('group', { name: 'Mapa de pastas descobertas' })
    expect(screen.getAllByText('mantém o histórico da V2')).toHaveLength(1) // lab-voz, adoptable in Pessoal
    fireEvent.click(screen.getByRole('checkbox', { name: /lab-voz/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /ymci/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Usar selecionadas (2)' }))
    expect(screen.queryByRole('group', { name: 'Mapa de pastas descobertas' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Analisar automático' }))
    expect(nameField().value).toBe('lab-voz')
    const radios = screen.getAllByRole('radio', { name: 'Principal' })
    expect(radios.map((radio) => radio.checked)).toEqual([true, false])
    // the primary row keeps the V2 history in Pessoal; the used-elsewhere row warns
    expect(screen.getAllByText('mantém o histórico da V2')).toHaveLength(1)
    expect(screen.getAllByText('já está em QA A › qa-a').length).toBeGreaterThan(0)
    await waitFor(() => expect(mutations.inspectFolders).toHaveBeenCalledWith({
      paths: ['D:\\projetos\\Pessoal\\lab-voz', 'D:\\projetos\\podesubir\\ymci'],
      excludeProjectId: null,
    }))
  })

  it('the history chip follows the chosen workspace: switching to one that does not own the folder drops it', async () => {
    open({ workspaceId: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Analisar automático' }))
    await screen.findByRole('group', { name: 'Mapa de pastas descobertas' })
    fireEvent.click(screen.getByRole('checkbox', { name: /lab-voz/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Usar selecionadas (1)' }))
    expect(screen.getAllByText('mantém o histórico da V2')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: '2' } })
    expect(screen.queryByText('mantém o histórico da V2')).toBeNull()
  })

  it('a failed scan says so and offers a retry', async () => {
    const discoverFolders = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(DISCOVER)
    open({ mutations: makeMutations({ discoverFolders }) })
    fireEvent.click(screen.getByRole('button', { name: 'Analisar automático' }))
    await screen.findByText('Não consegui varrer as pastas. Nada foi alterado.')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await screen.findByRole('checkbox', { name: /lab-voz/ })
    expect(discoverFolders).toHaveBeenCalledTimes(2)
  })
})

describe('ProjectDialog: "Cadastrar como projeto"', () => {
  it('pre-fills name and folder from the V2 map and keeps the history of the legacy key', async () => {
    const { mutations } = open({ mode: 'register', bucketKey: 'Pessoal/lab-voz', workspaceId: 1 })
    expect(nameField().value).toBe('lab-voz')
    await screen.findByText('D:\\projetos\\Pessoal\\lab-voz', { selector: '.v3-folder__path' })
    expect(screen.getByRole('radio', { name: 'Principal' }).checked).toBe(true)
    expect(screen.getByText('mantém o histórico da V2')).toBeTruthy()
    expect(screen.getByLabelText('Workspace').value).toBe('1')
    fireEvent.click(save())
    await waitFor(() => expect(mutations.createProject).toHaveBeenCalledWith(1, {
      name: 'lab-voz',
      folders: [{ path: 'D:\\projetos\\Pessoal\\lab-voz', isPrimary: true }],
    }))
  })

  it('when the map cannot be read it says so and the form stays usable', async () => {
    const discoverFolders = vi.fn().mockRejectedValue(new Error('boom'))
    open({ mode: 'register', bucketKey: 'Pessoal/lab-voz', workspaceId: 1, mutations: makeMutations({ discoverFolders }) })
    expect((await screen.findByRole('alert')).textContent).toContain('Não consegui ler o mapa de pastas da V2. Digite o caminho ou use Procurar.')
    expect(nameField().value).toBe('lab-voz')
    await addTyped('D:\manual')
  })

  it('when the folder is not in the map the form opens without a folder', async () => {
    const discoverFolders = vi.fn(async () => ({ ...DISCOVER, entries: [] }))
    open({ mode: 'register', bucketKey: 'Pessoal/gone', workspaceId: 1, mutations: makeMutations({ discoverFolders }) })
    expect(nameField().value).toBe('gone')
    await waitFor(() => expect(discoverFolders).toHaveBeenCalled())
    expect(await screen.findByText('Nenhuma pasta ainda. Digite um caminho, use Procurar ou Analisar automático.')).toBeTruthy()
  })
})

describe('ProjectDialog: editing', () => {
  const edit = (key, props = {}) => open({ mode: 'edit', project: projectByKey(key), ...props })

  it('titles it, fixes the workspace with the help text and has no origin selector', () => {
    edit('Pessoal/.p11')
    expect(screen.getByRole('heading', { name: 'Editar projeto' })).toBeTruthy()
    const select = screen.getByLabelText('Workspace')
    expect(select.disabled).toBe(true)
    expect(select.value).toBe('1')
    expect(document.getElementById(select.getAttribute('aria-describedby')).textContent).toBe('O workspace não muda depois que o projeto é criado.')
    expect(screen.queryByRole('radiogroup', { name: 'Origem' })).toBeNull()
    expect(nameField().value).toBe('qa-a')
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeTruthy()
  })

  it('a seeded project shows the lock note, a locked primary and editable extras', () => {
    edit('Pessoal/tn-sandbox')
    const note = document.getElementById('lock-note')
    expect(note.textContent).toBe(LOCK_TEXT)
    expect(screen.getByText('travada')).toBeTruthy()
    const removePrimary = screen.getByRole('button', { name: 'Remover pasta D:\\projetos\\Pessoal\\tn-sandbox' })
    expect(removePrimary.getAttribute('aria-disabled')).toBe('true')
    expect(removePrimary.getAttribute('aria-describedby')).toBe('lock-note')
    expect(screen.getByRole('button', { name: 'Remover pasta D:\\extras\\shared' }).hasAttribute('aria-disabled')).toBe(false)
  })

  it('a project without a lock shows no lock note', () => {
    edit('Pessoal/.p11')
    expect(document.getElementById('lock-note')).toBeNull()
  })

  it('a rename sends ONLY the name', async () => {
    const { mutations, onClose } = edit('Pessoal/tn-sandbox')
    fireEvent.change(nameField(), { target: { value: 'sandbox' } })
    fireEvent.click(save('Salvar alterações'))
    await waitFor(() => expect(mutations.updateProject).toHaveBeenCalledTimes(1))
    expect(mutations.updateProject).toHaveBeenCalledWith(10, { name: 'sandbox' })
    expect(mutations.inspectFolders).not.toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('saving without changes just closes', async () => {
    const { mutations, onClose } = edit('Pessoal/tn-sandbox')
    fireEvent.click(save('Salvar alterações'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mutations.updateProject).not.toHaveBeenCalled()
  })

  it('adding an extra to a seeded project resends the locked primary as stored and inspects only the typed rows', async () => {
    const { mutations } = edit('Pessoal/tn-sandbox')
    await addTyped('D:\\extras\\another')
    expect(mutations.inspectFolders).toHaveBeenLastCalledWith({ paths: ['D:\\extras\\another'], excludeProjectId: 10 })
    fireEvent.click(save('Salvar alterações'))
    await waitFor(() => expect(mutations.updateProject).toHaveBeenCalledTimes(1))
    expect(mutations.updateProject).toHaveBeenCalledWith(10, {
      folders: [
        { path: 'D:\\projetos\\Pessoal\\tn-sandbox', isPrimary: true },
        { path: 'D:\\extras\\shared', isPrimary: false },
        { path: 'D:\\extras\\another', isPrimary: false },
      ],
    })
    // the locked primary was never asked to /inspect; the saved extra and the new one were
    expect(mutations.inspectFolders).toHaveBeenLastCalledWith({ paths: ['D:\\extras\\shared', 'D:\\extras\\another'], excludeProjectId: 10 })
  })

  it('a 409 primary_locked from the server shows the lock text', async () => {
    const failure = Object.assign(new Error('x'), { status: 409, code: 'primary_locked' })
    edit('Pessoal/tn-sandbox', { mutations: makeMutations({ updateProject: vi.fn().mockRejectedValue(failure) }) })
    fireEvent.click(screen.getByRole('button', { name: 'Remover pasta D:\\extras\\shared' }))
    fireEvent.click(save('Salvar alterações'))
    expect((await screen.findByRole('alert')).textContent).toBe(LOCK_TEXT)
  })

  it('shows no "mantém o histórico da V2" while editing (adoption only happens on create)', async () => {
    edit('Pessoal/.p11')
    fireEvent.click(screen.getByRole('button', { name: 'Analisar automático' }))
    await screen.findByRole('group', { name: 'Mapa de pastas descobertas' })
    expect(screen.queryByText('mantém o histórico da V2')).toBeNull()
  })

  it('excludes the project itself from the discover warnings and from inspect', async () => {
    const own = { ...REF, project_id: 11 }
    const discoverFolders = vi.fn(async () => ({ ...DISCOVER, entries: [{ ...DISCOVER.entries[1], used_by: [own] }] }))
    edit('Pessoal/.p11', { mutations: makeMutations({ discoverFolders }) })
    fireEvent.click(screen.getByRole('button', { name: 'Analisar automático' }))
    await screen.findByRole('checkbox', { name: /ymci/ })
    expect(screen.queryByText('já está em QA A › qa-a')).toBeNull()
  })

  describe('archiving', () => {
    it('asks for confirmation inline and archives with only { archived: true }', async () => {
      const { mutations, onClose } = edit('Pessoal/.p11')
      expect(screen.getByText(/O projeto sai da lista/)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Arquivar projeto' }))
      expect(mutations.updateProject).not.toHaveBeenCalled()
      expect(screen.getByText('Arquivar "qa-a"?')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
      expect(screen.getByRole('button', { name: 'Arquivar projeto' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Arquivar projeto' }))
      fireEvent.click(screen.getByRole('button', { name: 'Sim, arquivar' }))
      await waitFor(() => expect(mutations.updateProject).toHaveBeenCalledWith(11, { archived: true }))
      await waitFor(() => expect(onClose).toHaveBeenCalled())
    })

    it('keeps the focus inside the dialog: on "Sim, arquivar" when the confirmation opens, back on "Arquivar projeto" on "Voltar"', () => {
      edit('Pessoal/.p11')
      const dialog = document.querySelector('dialog')
      const ask = screen.getByRole('button', { name: 'Arquivar projeto' })
      ask.focus()
      fireEvent.click(ask)
      const yes = screen.getByRole('button', { name: 'Sim, arquivar' })
      expect(document.activeElement).toBe(yes)
      expect(dialog.contains(document.activeElement)).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Voltar' }))
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Arquivar projeto' }))
      expect(dialog.contains(document.activeElement)).toBe(true)
    })

    it('a failed archive keeps the dialog open and says why', async () => {
      const failure = Object.assign(new Error('boom'), { status: 500 })
      const { onClose } = edit('Pessoal/.p11', { mutations: makeMutations({ updateProject: vi.fn().mockRejectedValue(failure) }) })
      fireEvent.click(screen.getByRole('button', { name: 'Arquivar projeto' }))
      fireEvent.click(screen.getByRole('button', { name: 'Sim, arquivar' }))
      expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível concluir agora. Nada foi alterado.')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('an archived project has no archive zone', () => {
      edit('Pessoal/old')
      expect(screen.queryByRole('button', { name: 'Arquivar projeto' })).toBeNull()
    })
  })

  describe('a locked primary whose folder left the disk (inherited item c)', () => {
    const GONE = buildRegistryIndex({
      workspaces: [{
        id: 1, key: 'Pessoal', name: 'Pessoal', origin: 'seed', archived: false,
        projects: [{
          id: 30, key: 'Pessoal/ghost', name: 'ghost', origin: 'seed', archived: false, primary_locked: true,
          folders: [folder(300, 'D:\\projetos\\Pessoal\\ghost', { exists: false })],
        }],
      }],
    })
    const ghost = GONE.projectByKey.get('Pessoal/ghost')

    it('says so on the row from the start: chip, hint with what still works', () => {
      open({ mode: 'edit', project: ghost, workspaces: GONE.workspaces })
      expect(screen.getByText('pasta não encontrada')).toBeTruthy()
      expect(screen.getByText(LOCKED_MISSING_HINT)).toBeTruthy()
    })

    it('renaming still works: only the name is sent and the folder is not inspected', async () => {
      const { mutations, onClose } = open({ mode: 'edit', project: ghost, workspaces: GONE.workspaces })
      fireEvent.change(nameField(), { target: { value: 'ghost-2' } })
      fireEvent.click(save('Salvar alterações'))
      await waitFor(() => expect(mutations.updateProject).toHaveBeenCalledWith(30, { name: 'ghost-2' }))
      expect(mutations.inspectFolders).not.toHaveBeenCalled()
      await waitFor(() => expect(onClose).toHaveBeenCalled())
    })

    it('archiving still works', async () => {
      const { mutations } = open({ mode: 'edit', project: ghost, workspaces: GONE.workspaces })
      fireEvent.click(screen.getByRole('button', { name: 'Arquivar projeto' }))
      fireEvent.click(screen.getByRole('button', { name: 'Sim, arquivar' }))
      await waitFor(() => expect(mutations.updateProject).toHaveBeenCalledWith(30, { archived: true }))
    })

    it('adding an extra is refused by the server with not_found on the locked row, which keeps the explanation', async () => {
      const failure = Object.assign(new Error('A pasta não existe nesta máquina.'), {
        status: 400,
        problems: [{ path: 'D:\\projetos\\Pessoal\\ghost', code: 'not_found', message: 'A pasta não existe nesta máquina.' }],
      })
      const { onClose } = open({
        mode: 'edit', project: ghost, workspaces: GONE.workspaces, mutations: makeMutations({ updateProject: vi.fn().mockRejectedValueOnce(failure).mockResolvedValue({ project: { id: 30 } }) }),
      })
      await addTyped('D:\\extras\\new')
      fireEvent.click(save('Salvar alterações'))
      const row = screen.getByText('D:\\projetos\\Pessoal\\ghost', { selector: '.v3-folder__path' }).closest('li')
      await waitFor(() => expect(within(row).getByRole('alert').textContent).toBe('Erro: A pasta não existe nesta máquina.'))
      expect(within(row).getByText(LOCKED_MISSING_HINT)).toBeTruthy()
      expect(onClose).not.toHaveBeenCalled()
      // removing the extra makes the folders unchanged again, so a rename goes through
      fireEvent.click(screen.getByRole('button', { name: 'Remover pasta D:\\extras\\new' }))
      fireEvent.change(nameField(), { target: { value: 'ghost-3' } })
      fireEvent.click(save('Salvar alterações'))
      await waitFor(() => expect(onClose).toHaveBeenCalled())
    })
  })
})

describe('ProjectDialog: closing', () => {
  it('Cancelar, Fechar and Escape all go through onClose', () => {
    const { onClose } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    fireEvent.keyDown(nameField(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
