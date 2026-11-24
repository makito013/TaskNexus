import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import SlashMenu from './SlashMenu.jsx'
import { GROUPS, commandNameOf, matchCommands, originLabel, selectableCommands } from './slashCommands.js'

afterEach(cleanup)

const ITEMS = selectableCommands([
  { name: 'b-user', description: 'two', source: 'user', handling: 'dispatch' },
  { name: 'a-project', description: 'one', source: 'project', handling: 'dispatch' },
  { name: 'acme:deploy', description: 'plugin one', source: 'plugin', handling: 'dispatch' },
  { name: 'model', description: 'switch', source: 'builtin', handling: 'ui' },
  { name: 'ghost', description: 'x', source: 'session', handling: 'dispatch' },
  { name: 'weird', description: 'ui without a card', source: 'builtin', handling: 'ui' },
  { name: 'hid', description: '', source: 'builtin', handling: 'hidden' },
  { name: 'a-project', description: 'dup', source: 'user', handling: 'dispatch' },
])

describe('slashCommands', () => {
  it('selectableCommands drops hidden, repeated and "ui" commands that have no card', () => {
    expect(ITEMS.map((item) => item.name)).toEqual(['b-user', 'a-project', 'acme:deploy', 'model', 'ghost'])
  })

  it('an unknown source counts as "session"', () => {
    expect(selectableCommands([{ name: 'x', source: 'martian', handling: 'dispatch' }])[0].source).toBe('session')
  })

  it.each([
    [{ source: 'project', name: 'x' }, 'projeto'],
    [{ source: 'user', name: 'x' }, 'usuário'],
    [{ source: 'plugin', name: 'acme:deploy' }, 'plugin:acme'],
    [{ source: 'plugin', name: 'noprefix' }, 'plugin'],
    [{ source: 'builtin', name: 'x' }, 'interno'],
    [{ source: 'session', name: 'x' }, 'sessão'],
  ])('originLabel %j is "%s"', (item, label) => {
    expect(originLabel(item)).toBe(label)
  })

  it('an empty search is grouped in the order of GROUPS and by name inside', () => {
    const { flat, groups } = matchCommands(ITEMS, '')
    expect(groups.map((group) => group.label)).toEqual(GROUPS.map((group) => group.label))
    expect(flat.map((item) => item.name)).toEqual(['a-project', 'b-user', 'acme:deploy', 'model', 'ghost'])
  })

  it('a typed search is flat: starts-with, then contains in the name, then in the description', () => {
    const items = selectableCommands([
      { name: 'zeta', description: 'has dep inside', source: 'user', handling: 'dispatch' },
      { name: 'redeploy', description: '', source: 'user', handling: 'dispatch' },
      { name: 'deploy', description: '', source: 'user', handling: 'dispatch' },
      { name: 'other', description: '', source: 'user', handling: 'dispatch' },
    ])
    const { flat, groups } = matchCommands(items, 'DEP')
    expect(groups).toBeNull()
    expect(flat.map((item) => item.name)).toEqual(['deploy', 'redeploy', 'zeta'])
  })

  it('commandNameOf reads the first word of a slash text only', () => {
    expect(commandNameOf('/model')).toBe('model')
    expect(commandNameOf('  /model sonnet')).toBe('model')
    expect(commandNameOf('model')).toBeNull()
    expect(commandNameOf('oi /model')).toBeNull()
  })
})

describe('SlashMenu', () => {
  it('rows have role option, the active one is selected, and a click picks it', () => {
    const onChoose = vi.fn()
    render(<SlashMenu status="ready" match={matchCommands(ITEMS, '')} query="" activeIndex={1} onChoose={onChoose} />)
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(5)
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false', 'false'])
    fireEvent.click(options[2])
    expect(onChoose).toHaveBeenCalledWith(2)
  })

  it('a press on a row does not take the focus from the textarea', () => {
    render(<SlashMenu status="ready" match={matchCommands(ITEMS, '')} query="" activeIndex={0} onChoose={() => {}} />)
    expect(fireEvent.mouseDown(screen.getAllByRole('option')[0])).toBe(false)
  })

  it('the "ui" row is marked as opening a card and the plugin seal carries the plugin name', () => {
    render(<SlashMenu status="ready" match={matchCommands(ITEMS, '')} query="" activeIndex={0} onChoose={() => {}} />)
    expect(screen.getByText('abre um cartão')).toBeTruthy()
    expect(screen.getByText('plugin:acme')).toBeTruthy()
  })
})
