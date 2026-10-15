// QA coverage for the v3 shell (phase 4): spec copy, CSS contracts and real
// browser-history navigation that the unit tests of each piece do not pin down.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { api } from '../../services/api.js'
import AppV3 from './AppV3.jsx'

const here = path.dirname(fileURLToPath(import.meta.url))
const readCss = (relative) => fs.readFileSync(path.join(here, relative), 'utf8')

const SPEC_COPY = {
  '/home': {
    island: 'Ainda não abri o Início. Volto logo.',
    panel: 'Ainda estou me arrumando. Quando eu acordar, resumo o seu dia e chamo o colega certo.',
    pet: 'bit',
    name: 'Bit',
  },
  '/finance': {
    island: 'Ainda não cheguei por aqui.',
    panel: 'Ainda não cheguei. Quando eu acordar, falo de dinheiro com calma e peço sua aprovação antes de mexer em algo.',
    pet: 'fin',
    name: 'Fin',
  },
  '/projects': {
    island: 'Ainda não abri minha tela.',
    panel: 'Ainda não abri minha tela. Por enquanto, seus projetos e agentes ficam no layout atual: inicie o TaskNexus sem --v3 pra usá-los.',
    pet: 'kan',
    name: 'Kan',
  },
  '/browser': {
    island: 'Ainda estou me preparando.',
    panel: 'Ainda estou me preparando. Quando eu acordar, pesquiso, leio a página inteira e volto com resumo e links.',
    pet: 'navi',
    name: 'Navi',
  },
}

describe('v3 shell QA', () => {
  beforeEach(() => {
    window.localStorage.clear()
    // The Tarefas screen fetches on mount; keep every test off the network.
    vi.spyOn(api, 'fetchGlobalTasks').mockResolvedValue([])
    vi.spyOn(api, 'fetchCards').mockResolvedValue([])
    vi.spyOn(api, 'fetchBoardColumns').mockResolvedValue([])
    vi.spyOn(api, 'fetchProjects').mockResolvedValue([])
  })
  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/')
  })

  it.each(Object.entries(SPEC_COPY))('shows the spec copy in the voice of the pet for %s', (route, spec) => {
    window.history.replaceState({}, '', route)
    render(<AppV3 initialTheme="light" />)
    const island = screen.getByRole('region', { name: 'Equipe' })
    expect(within(island).getByRole('status').textContent).toBe(spec.island)
    expect(within(island).getByText(spec.name)).toBeTruthy()
    expect(island.querySelector(`.v3-pet--${spec.pet}.v3-pet--sleeping`)).toBeTruthy()
    expect(screen.getByRole('main').textContent).toContain(spec.panel)
    // only the four colleague buttons: no actions and no voice button
    const islandButtons = within(island).getAllByRole('button')
    expect(islandButtons).toHaveLength(4)
    expect(islandButtons.every((b) => /^Abrir .+ com .+$/.test(b.getAttribute('aria-label')))).toBe(true)
  })

  it('lists the colleagues in rail order without the active module', () => {
    window.history.replaceState({}, '', '/finance')
    render(<AppV3 initialTheme="light" />)
    const island = screen.getByRole('region', { name: 'Equipe' })
    expect(within(island).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Abrir Início com Bit',
      'Abrir Tarefas com Tiq',
      'Abrir Projetos com Kan',
      'Abrir Navegador com Navi',
    ])
  })

  it('the four modules without a screen say "Em breve" as text in the rail', () => {
    window.history.replaceState({}, '', '/tasks')
    render(<AppV3 initialTheme="light" />)
    const rail = screen.getByRole('navigation', { name: 'Módulos' })
    const soon = rail.querySelectorAll('.v3-rail__soon')
    expect(soon).toHaveLength(4)
    soon.forEach((node) => expect(node.textContent).toBe('Em breve'))
    expect(screen.getByRole('button', { name: 'Tarefas' }).querySelector('.v3-rail__soon')).toBeNull()
  })

  it('rail controls are native buttons in DOM (tab) order, with no positive tabindex', () => {
    window.history.replaceState({}, '', '/tasks')
    render(<AppV3 initialTheme="light" />)
    const rail = screen.getByRole('navigation', { name: 'Módulos' })
    const focusables = [...rail.querySelectorAll('button, a[href], [tabindex]')]
    expect(focusables.map((el) => el.tagName)).toEqual(Array(6).fill('BUTTON'))
    expect(focusables.every((el) => !(el.tabIndex > 0))).toBe(true)
    expect(focusables.map((el) => el.getAttribute('aria-label'))).toEqual([
      'Início, em breve',
      'Tarefas',
      'Finanças, em breve',
      'Projetos e agentes, em breve',
      'Navegador, em breve',
      'Mudar para tema escuro',
    ])
    // the rail comes before the island and the screen in DOM order
    const island = screen.getByRole('region', { name: 'Equipe' })
    expect(rail.compareDocumentPosition(island) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('browser back and forward walk through the modules through the real history', async () => {
    window.history.replaceState({}, '', '/tasks')
    const lengthBefore = window.history.length
    render(<AppV3 initialTheme="light" />)
    fireEvent.click(screen.getByRole('button', { name: 'Finanças, em breve' }))
    fireEvent.click(screen.getByRole('button', { name: 'Navegador, em breve' }))
    expect(window.history.length).toBe(lengthBefore + 2)

    window.history.back()
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Finanças' })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Finanças, em breve' }).getAttribute('aria-current')).toBe('page')
    window.history.back()
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Tarefas' })).toBeTruthy())
    window.history.forward()
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Finanças' })).toBeTruthy())
  })

  it('redirecting / does not add a history entry', () => {
    window.history.replaceState({}, '', '/')
    const lengthBefore = window.history.length
    render(<AppV3 initialTheme="light" />)
    expect(window.location.pathname).toBe('/tasks')
    expect(window.history.length).toBe(lengthBefore)
  })

  it('does not expose the gallery in the rail or the island', () => {
    window.history.replaceState({}, '', '/tasks')
    render(<AppV3 initialTheme="light" />)
    expect(document.querySelector('a[href*="gallery"]')).toBeNull()
    expect(screen.queryByText(/galeria/i)).toBeNull()
  })
})

describe('v3 shell CSS contracts', () => {
  it('rail token is 84px and items are 72px wide with a 56px minimum height', () => {
    expect(readCss('./theme/tokens.css')).toMatch(/--v3-rail:\s*84px/)
    const rail = readCss('./components/ModuleRail/ModuleRail.css')
    expect(rail).toMatch(/\.v3-rail__item\s*\{[^}]*width:\s*72px/)
    expect(rail).toMatch(/\.v3-rail__item\s*\{[^}]*min-height:\s*56px/)
    expect(rail).toMatch(/\.v3-rail__theme\s*\{[^}]*width:\s*48px[^}]*height:\s*48px/s)
  })

  it('screen headings shrink to the text so the focus ring hugs it, and the ring is not removed', () => {
    expect(readCss('./AppV3.css')).toMatch(/\.v3-screen__title\s*\{[^}]*align-self:\s*flex-start/)
    expect(readCss('./components/ComingSoon/ComingSoon.css')).toMatch(
      /\.v3-coming-soon__title\s*\{[^}]*align-self:\s*flex-start/,
    )
    const base = readCss('./theme/base.css')
    expect(base).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px/)
    expect(base).not.toMatch(/outline:\s*none/)
  })

  it('island focus ring uses the island ink and the entrance only animates opacity', () => {
    const css = readCss('./components/Island/Island.css')
    expect(css).toMatch(/\.v3-island :focus-visible\s*\{\s*outline-color:\s*var\(--v3-island-ink\)/)
    const keyframes = css.match(/@keyframes v3-island-in\s*\{([\s\S]*?)\n\}/)[1]
    const props = [...keyframes.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])
    expect(new Set(props)).toEqual(new Set(['opacity']))
    expect(css).toMatch(/position:\s*sticky/)
  })

  it('island buttons and the island button variant use label size at weight 600', () => {
    expect(readCss('./components/Island/Island.css')).toMatch(
      /\.v3-island \.v3-button\s*\{[^}]*font-size:\s*var\(--v3-type-label-size\)[^}]*font-weight:\s*600/s,
    )
    expect(readCss('./components/Button/Button.css')).toMatch(
      /\.v3-button--island\s*\{[^}]*font-size:\s*var\(--v3-type-label-size\)[^}]*font-weight:\s*600/s,
    )
  })

  it('the shell stylesheets never use position: fixed', () => {
    const files = [
      './AppV3.css',
      './components/Island/Island.css',
      './components/ModuleRail/ModuleRail.css',
      './components/ComingSoon/ComingSoon.css',
    ]
    for (const file of files) {
      const withoutComments = readCss(file).replace(/\/\*[\s\S]*?\*\//g, '')
      expect(withoutComments, file).not.toMatch(/position:\s*fixed/)
    }
  })
})

describe('ModuleRail short-window CSS contract', () => {
  const rail = () => readCss('./components/ModuleRail/ModuleRail.css').replace(/\/\*[\s\S]*?\*\//g, '')

  it('rail children never shrink, so a short window scrolls the rail instead of squashing it', () => {
    expect(rail()).toMatch(/\.v3-rail\s*>\s*\*\s*\{[^}]*flex-shrink:\s*0/)
    expect(rail()).toMatch(/\.v3-rail\s*\{[^}]*overflow-y:\s*auto/)
  })

  it('active bar sits at left:-3px so it stays visible with and without the scrollbar', () => {
    // Rail is 84px with a 1px right border = 83px content box; the global 4px scrollbar
    // (index.css) can take 4 more = 79px. The 72px item is centered at 5.5px / 3.5px from
    // the edge, so a 3px bar at -3px is visible in both; the old -6px clipped it.
    const bar = rail().match(/\.v3-rail__item--active::before\s*\{([^}]*)\}/)[1]
    expect(bar).toMatch(/left:\s*-3px/)
    expect(bar).toMatch(/width:\s*3px/)
  })
})
