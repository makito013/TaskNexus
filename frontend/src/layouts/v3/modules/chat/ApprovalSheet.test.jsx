import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'
import { installDialogElementStub } from '../../../../test/dialogElementStub.js'
import PermissionCard from './PermissionCard.jsx'

installDialogElementStub()

beforeEach(() => {
  // The sheet and the card are two buttons of the same name: the tests tell them apart by container.
})
afterEach(() => cleanup())

const EDIT = {
  id: 'perm-edit',
  kind: 'tool',
  toolName: 'Edit',
  input: { file_path: 'C:/work/app.js', old_string: 'const a = 1', new_string: 'const a = 2' },
  allowSession: true,
  status: 'pending',
}
const BASH = {
  id: 'perm-bash',
  kind: 'tool',
  toolName: 'Bash',
  input: { command: 'npm test -- --run' },
  allowSession: false,
  status: 'pending',
}

function setup({ card = EDIT, phone = true, decision, onDecide = vi.fn(), focusAfterDecision = vi.fn() } = {}) {
  const view = render(
    <PermissionCard
      card={card}
      agentName="Claude"
      context="tn-sandbox"
      decision={decision}
      onDecide={onDecide}
      focusAfterDecision={focusAfterDecision}
      phone={phone}
    />,
  )
  return { onDecide, focusAfterDecision, ...view }
}

const summaryButton = () => screen.getByRole('button', { name: /Ver pedido completo/ })
const openSheet = () => fireEvent.click(summaryButton())
const sheet = () => screen.getByRole('dialog')

describe('phone: the card summary and the sheet', () => {
  it('the summary is ONE button of its own and holds no other control (no control inside a control)', () => {
    setup()
    const button = summaryButton()
    expect(button.querySelector('button, a, input, select, textarea, [role="button"], [tabindex]')).toBeNull()
    expect(button.textContent).toContain('Claude')
    expect(button.textContent).toContain('C:/work/app.js')
    const decisions = ['Permitir', 'Permitir nesta conversa', 'Negar', 'Negar e parar']
    for (const name of decisions) {
      const decision = screen.getByRole('button', { name: new RegExp(`^${name}$`) })
      expect(button.contains(decision)).toBe(false)
      expect(decision.className).toContain('v3-button--lg')
    }
  })

  it('is not a button on a wider screen: the summary stays plain text and no sheet exists', () => {
    setup({ phone: false })
    expect(screen.queryByRole('button', { name: /Ver pedido completo/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the sheet from the summary: bottom sheet, titled, with the four decisions in the footer', () => {
    setup()
    openSheet()
    const dialog = sheet()
    expect(dialog.className).toContain('v3-dialog--sheet')
    expect(within(dialog).getByRole('heading', { name: 'Pedido de permissão' })).toBeTruthy()
    const footer = dialog.querySelector('.v3-dialog__footer')
    const names = within(footer).getAllByRole('button').map((button) => button.textContent)
    expect(names).toEqual(['Permitir', 'Permitir nesta conversa', 'Negar', 'Negar e parar'])
    for (const button of within(footer).getAllByRole('button')) expect(button.className).toContain('v3-button--lg')
  })

  it('puts the initial focus on the title of the sheet; the request is the first thing after it', () => {
    setup()
    openSheet()
    const heading = within(sheet()).getByRole('heading', { name: 'Pedido de permissão' })
    expect(document.activeElement).toBe(heading)
    expect(sheet().querySelector('.v3-approval-sheet__request').textContent).toContain('quer editar')
  })

  it('shows the whole command, never clipped', () => {
    const longCommand = `echo ${'a'.repeat(400)}`
    setup({ card: { ...BASH, input: { command: longCommand } } })
    openSheet()
    expect(within(sheet()).getByText(longCommand)).toBeTruthy()
  })
})

describe('the sheet closes without deciding', () => {
  it.each([
    ['Esc', () => fireEvent.keyDown(sheet(), { key: 'Escape' })],
    ['the Fechar button', () => fireEvent.click(within(sheet()).getByRole('button', { name: 'Fechar' }))],
    ['a press on the scrim', () => {
      fireEvent.mouseDown(sheet())
      fireEvent.click(sheet())
    }],
  ])('%s closes it, decides nothing and gives the focus back to the summary', (_label, close) => {
    const { onDecide, focusAfterDecision } = setup()
    openSheet()
    close()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onDecide).not.toHaveBeenCalled()
    expect(focusAfterDecision).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(summaryButton())
  })

  it('closes by itself when the request is settled elsewhere', () => {
    const { rerender } = setup()
    openSheet()
    rerender(
      <PermissionCard
        card={{ ...EDIT, status: 'allowed', decidedElsewhere: true }}
        agentName="Claude"
        context="tn-sandbox"
        onDecide={vi.fn()}
        focusAfterDecision={vi.fn()}
        phone
      />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(/Decidido em outro dispositivo/)).toBeTruthy()
  })
})

describe('a decision taken in the sheet', () => {
  it.each([
    ['Permitir', { behavior: 'allow' }],
    ['Permitir nesta conversa', { behavior: 'allow', scope: 'session' }],
    ['Negar e parar', { behavior: 'deny', interrupt: true }],
  ])('%s closes the sheet, is sent once and hands the focus to the composer', (name, payload) => {
    const { onDecide, focusAfterDecision } = setup()
    openSheet()
    fireEvent.click(within(sheet().querySelector('.v3-dialog__footer')).getByRole('button', { name: new RegExp(`^${name}$`) }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onDecide).toHaveBeenCalledTimes(1)
    expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ id: 'perm-edit' }), payload)
    expect(focusAfterDecision).toHaveBeenCalledTimes(1)
  })

  it('"Negar" asks for a reason first and sends it; Esc in the reason box is kept from cancelling the sheet', () => {
    const { onDecide } = setup()
    openSheet()
    fireEvent.click(within(sheet()).getByRole('button', { name: /^Negar$/ }))
    const reason = within(sheet()).getByRole('textbox', { name: 'Motivo (opcional)' })
    // fireEvent returns false when the default action was prevented: a real <dialog> then does not cancel.
    expect(fireEvent.keyDown(reason, { key: 'Escape' })).toBe(false)
    expect(onDecide).not.toHaveBeenCalled()
  })

  it('sends the reason of a denial and closes the sheet', () => {
    const { onDecide } = setup()
    openSheet()
    fireEvent.click(within(sheet()).getByRole('button', { name: /^Negar$/ }))
    fireEvent.change(within(sheet()).getByRole('textbox', { name: 'Motivo (opcional)' }), { target: { value: 'não agora' } })
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Confirmar negação' }))
    expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ id: 'perm-edit' }), { behavior: 'deny', message: 'não agora' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not send a second decision while one is out', () => {
    const { onDecide } = setup({ decision: { phase: 'sending', kind: 'allow' } })
    openSheet()
    fireEvent.click(within(sheet().querySelector('.v3-dialog__footer')).getByRole('button', { name: /^Enviando…$/ }))
    expect(onDecide).not.toHaveBeenCalled()
  })

  it('shows the failure inside the sheet and keeps the buttons usable', () => {
    setup({ decision: { phase: 'error', kind: 'allow' } })
    openSheet()
    expect(within(sheet()).getByRole('alert').textContent).toContain('Não foi possível enviar sua decisão')
    expect(within(sheet()).getByRole('button', { name: /^Permitir$/ }).getAttribute('aria-disabled')).toBeNull()
  })
})

describe('tabs Resumo / Diff', () => {
  it('Edit and Write get a Resumo and a Diff tab; the diff is only on its tab', () => {
    setup()
    openSheet()
    const tabs = within(sheet()).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Resumo', 'Diff'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(sheet().querySelector('.v3-chat-diff')).toBeNull()
    fireEvent.click(tabs[1])
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    const diff = sheet().querySelector('.v3-chat-diff')
    expect(diff.textContent).toContain('const a = 1')
    expect(diff.textContent).toContain('const a = 2')
  })

  it('the arrow keys move between the tabs', () => {
    setup()
    openSheet()
    const [summaryTab, diffTab] = within(sheet()).getAllByRole('tab')
    summaryTab.focus()
    fireEvent.keyDown(summaryTab, { key: 'ArrowRight' })
    expect(diffTab.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(diffTab)
  })

  it('a tool without a diff has no tab bar', () => {
    setup({ card: BASH })
    openSheet()
    expect(within(sheet()).queryByRole('tablist')).toBeNull()
    expect(within(sheet()).queryByRole('tab')).toBeNull()
  })

  it('a tool whose input is shown as text (no diff) keeps it under the summary, with no tab bar', () => {
    setup({ card: { id: 'perm-x', kind: 'tool', toolName: 'SomeNewTool', input: { target: 'alpha-service' }, allowSession: false, status: 'pending' } })
    openSheet()
    expect(within(sheet()).queryByRole('tablist')).toBeNull()
    expect(sheet().querySelector('.v3-approval-sheet__details').textContent).toContain('alpha-service')
  })
})

describe('the question and plan cards stay inline on a phone', () => {
  it('a question card has no summary button and no sheet', () => {
    setup({
      card: {
        id: 'perm-q',
        kind: 'question',
        toolName: 'AskUserQuestion',
        input: { questions: [{ question: 'Qual?', header: 'H', options: [{ label: 'A' }, { label: 'B' }] }] },
        status: 'pending',
        questions: [{ question: 'Qual?', header: 'H', multi: false, options: [{ label: 'A', value: 'A' }, { label: 'B', value: 'B' }] }],
      },
    })
    expect(screen.queryByRole('button', { name: /Ver pedido completo/ })).toBeNull()
    act(() => {})
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

// jsdom has no layout: the scroll geometry is simulated per element, by class, the way the QA probe
// measured it in a real browser (the command box and the body of the sheet are two scrollers).
describe('the sheet says so when the request continues below the visible area (Revisor C5, B1)', () => {
  const NOTICE = /continua/i
  let geometry

  beforeEach(() => {
    geometry = { object: { scroll: 0, client: 0 }, body: { scroll: 0, client: 0 } }
    const read = (element, key) => {
      if (element.classList.contains('v3-approval-sheet__object')) return geometry.object[key]
      if (element.classList.contains('v3-dialog__body')) return geometry.body[key]
      return 0
    }
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function scrollHeight() { return read(this, 'scroll') })
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function clientHeight() { return read(this, 'client') })
  })
  afterEach(() => vi.restoreAllMocks())

  const notice = () => sheet().querySelector('.v3-approval-sheet__more')
  const scrollTo = (element, top) => {
    Object.defineProperty(element, 'scrollTop', { value: top, configurable: true, writable: true })
    fireEvent.scroll(element)
  }
  const overflowingObject = () => { geometry.object = { scroll: 836, client: 316 } }

  it('shows a visible, announced notice in the footer when the command box is cut, and keeps Permitir usable', () => {
    overflowingObject()
    setup({ card: BASH })
    openSheet()
    expect(notice().textContent).toMatch(NOTICE)
    expect(notice().getAttribute('role')).toBe('status')
    // Outside the scrolling body (otherwise it would be as hidden as the tail it warns about).
    expect(notice().closest('.v3-dialog__footer')).not.toBeNull()
    expect(sheet().querySelector('.v3-dialog__body').contains(notice())).toBe(false)
    const allow = within(sheet().querySelector('.v3-dialog__footer')).getByRole('button', { name: /^Permitir$/ })
    expect(allow.getAttribute('aria-disabled')).toBeNull()
    expect(allow.disabled).toBe(false)
  })

  it('says nothing when everything fits', () => {
    geometry.object = { scroll: 40, client: 40 }
    geometry.body = { scroll: 300, client: 300 }
    setup({ card: BASH })
    openSheet()
    expect(notice().textContent).toBe('')
  })

  it('also warns when the body of the sheet is the one that scrolls (a long input shown under the summary)', () => {
    geometry.object = { scroll: 40, client: 40 }
    geometry.body = { scroll: 900, client: 420 }
    setup({ card: BASH })
    openSheet()
    expect(notice().textContent).toMatch(NOTICE)
  })

  it('is evaluated again when the window is resized (rotation, soft keyboard)', () => {
    geometry.object = { scroll: 200, client: 200 }
    setup({ card: BASH })
    openSheet()
    expect(notice().textContent).toBe('')
    overflowingObject()
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(notice().textContent).toMatch(NOTICE)
    geometry.object = { scroll: 200, client: 200 }
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(notice().textContent).toBe('')
  })

  it('goes away once the end is reached and comes back when the reader scrolls up', () => {
    overflowingObject()
    setup({ card: BASH })
    openSheet()
    const box = sheet().querySelector('.v3-approval-sheet__object')
    scrollTo(box, 520)
    expect(notice().textContent).toBe('')
    scrollTo(box, 100)
    expect(notice().textContent).toMatch(NOTICE)
  })

  it('is evaluated again when the tab changes (the diff has no command box, only the body scrolls)', () => {
    geometry.object = { scroll: 40, client: 40 }
    geometry.body = { scroll: 300, client: 300 }
    setup()
    openSheet()
    expect(notice().textContent).toBe('')
    geometry.body = { scroll: 1200, client: 420 }
    fireEvent.click(within(sheet()).getByRole('tab', { name: 'Diff' }))
    expect(notice().textContent).toMatch(NOTICE)
  })
})

describe('a sheet that closes without a decision from the person (Revisor C5, ressalva 2)', () => {
  const rerenderWith = (view, props, card = EDIT) => view.rerender(
    <PermissionCard
      card={card}
      agentName="Claude"
      context="tn-sandbox"
      onDecide={vi.fn()}
      focusAfterDecision={view.focusAfterDecision}
      phone
      {...props}
    />,
  )

  it('hands the focus to the composer when the request is settled elsewhere', () => {
    const view = setup()
    openSheet()
    rerenderWith(view, {}, { ...EDIT, status: 'allowed', decidedElsewhere: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(view.focusAfterDecision).toHaveBeenCalledTimes(1)
  })

  it('hands the focus to the composer when the device rotates past 767 and the sheet goes away', () => {
    const view = setup()
    openSheet()
    rerenderWith(view, { phone: false })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(view.focusAfterDecision).toHaveBeenCalledTimes(1)
  })

  it('does not steal the focus when the person closes it themselves (it goes back to the summary)', () => {
    const view = setup()
    openSheet()
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Fechar' }))
    expect(view.focusAfterDecision).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(summaryButton())
  })
})
