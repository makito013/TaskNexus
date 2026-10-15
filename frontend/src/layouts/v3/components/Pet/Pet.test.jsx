import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import Pet from './Pet.jsx'
import { PET_IDS, PET_NAMES } from './petShapes.js'
import { PET_STATES, STATE_LABELS } from './petStates.js'

const originalMatchMedia = window.matchMedia

function preferReducedMotion() {
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
}

afterEach(() => {
  if (originalMatchMedia) window.matchMedia = originalMatchMedia
  else delete window.matchMedia
})

const smilElements = (container) => container.querySelectorAll('animate, animateTransform')

const ALL_PETS_AND_STATES = PET_IDS.flatMap((pet) => PET_STATES.map((state) => [pet, state]))

describe('Pet', () => {
  it.each(ALL_PETS_AND_STATES)('renders role img with name and state label for %s in %s', (pet, state) => {
    render(<Pet pet={pet} state={state} />)
    const svg = screen.getByRole('img')
    expect(svg.getAttribute('aria-label')).toBe(`${PET_NAMES[pet]} ${STATE_LABELS[state]}`)
    expect(svg.getAttribute('class')).toContain(`v3-pet v3-pet--${pet} v3-pet--${state}`)
    expect(svg.getAttribute('viewBox')).toBe('0 0 48 48')
  })

  it('names the example states in pt-BR', () => {
    render(<Pet pet="tiq" state="alert" />)
    expect(screen.getByRole('img', { name: 'Tiq em alerta' })).toBeTruthy()
  })

  it('renders aria-hidden without role when decorative', () => {
    const { container } = render(<Pet pet="fin" state="sleeping" decorative />)
    const svg = container.querySelector('svg')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.hasAttribute('role')).toBe(false)
    expect(svg.hasAttribute('aria-label')).toBe(false)
  })

  it('maps front, side and nav sizes to 60, 40 and 34', () => {
    const sizes = ['front', 'side', 'nav'].map((size) => {
      const { container, unmount } = render(<Pet pet="bit" size={size} />)
      const svg = container.querySelector('svg')
      const result = [svg.getAttribute('width'), svg.getAttribute('height')]
      unmount()
      return result
    })
    expect(sizes).toEqual([['60', '60'], ['40', '40'], ['34', '34']])
  })

  it('accepts a number of pixels as size', () => {
    const { container } = render(<Pet pet="kan" size={96} />)
    expect(container.querySelector('svg').getAttribute('width')).toBe('96')
  })

  it('uses only token custom properties for fill and stroke', () => {
    for (const [pet, state] of ALL_PETS_AND_STATES) {
      const { container, unmount } = render(<Pet pet={pet} state={state} />)
      for (const element of container.querySelectorAll('[fill], [stroke]')) {
        for (const attribute of ['fill', 'stroke']) {
          const value = element.getAttribute(attribute)
          if (value === null || value === 'none') continue
          expect(value, `${pet}/${state} ${attribute}`).toMatch(/^var\(--v3-[a-z-]+\)$/)
        }
      }
      unmount()
    }
  })

  it('renders SMIL elements when motion is allowed', () => {
    const { container } = render(<Pet pet="tiq" state="idle" />)
    expect(smilElements(container).length).toBeGreaterThan(0)
    expect(container.querySelector('animateTransform[type="translate"]')).not.toBeNull()
  })

  it('omits every SMIL element when reduced motion is preferred', () => {
    preferReducedMotion()
    for (const state of PET_STATES) {
      const { container, unmount } = render(<Pet pet="navi" state={state} />)
      expect(smilElements(container).length, state).toBe(0)
      unmount()
    }
  })

  it('draws the shadow at rx 11 when motion is reduced', () => {
    preferReducedMotion()
    const { container } = render(<Pet pet="fin" />)
    expect(container.querySelector('ellipse').getAttribute('rx')).toBe('11')
  })

  it('nav size never renders SMIL elements or the shadow', () => {
    for (const state of PET_STATES) {
      const { container, unmount } = render(<Pet pet="tiq" state={state} size="nav" decorative />)
      expect(smilElements(container).length, state).toBe(0)
      expect(container.querySelector('ellipse'), state).toBeNull()
      unmount()
    }
  })

  it('alert renders the ring only when motion is allowed', () => {
    const { container, unmount } = render(<Pet pet="tiq" state="alert" />)
    expect(container.querySelector('circle[stroke="var(--v3-fin)"]')).not.toBeNull()
    unmount()
    preferReducedMotion()
    const reduced = render(<Pet pet="tiq" state="alert" />)
    expect(reduced.container.querySelector('circle[stroke="var(--v3-fin)"]')).toBeNull()
  })

  it('sleeping renders the zzz dots with a delayed second dot', () => {
    const { container } = render(<Pet pet="kan" state="sleeping" />)
    const dots = [...container.querySelectorAll('svg > circle')]
    expect(dots).toHaveLength(2)
    const delays = dots.map((dot) => dot.querySelector('animate[attributeName="cy"]').getAttribute('begin'))
    expect(delays).toEqual([null, '1.2s'])
  })

  it('sleeping shows no zzz dots when motion is reduced', () => {
    preferReducedMotion()
    const { container } = render(<Pet pet="kan" state="sleeping" />)
    expect(container.querySelectorAll('svg > circle')).toHaveLength(0)
  })

  it('thinking renders the rotate group', () => {
    const { container } = render(<Pet pet="bit" state="thinking" />)
    expect(container.querySelector('.v3-pet__tilt animateTransform[type="rotate"]')).not.toBeNull()
  })

  it('only thinking tilts', () => {
    const { container } = render(<Pet pet="bit" state="talking" />)
    expect(container.querySelector('animateTransform[type="rotate"]')).toBeNull()
  })

  it('remounts the LED group when the state changes', () => {
    const { container, rerender } = render(<Pet pet="tiq" state="idle" />)
    const before = container.querySelector('.v3-pet__led')
    rerender(<Pet pet="tiq" state="talking" />)
    const after = container.querySelector('.v3-pet__led')
    expect(after).not.toBe(before)
    expect(before.isConnected).toBe(false)
  })

  it('keeps the LED group when only the pet props other than state change', () => {
    const { container, rerender } = render(<Pet pet="tiq" state="idle" size="front" />)
    const before = container.querySelector('.v3-pet__led')
    rerender(<Pet pet="tiq" state="idle" size="side" />)
    expect(container.querySelector('.v3-pet__led')).toBe(before)
  })

  it('side idle pets breathe out of sync', () => {
    const durations = PET_IDS.map((pet) => {
      const { container, unmount } = render(<Pet pet={pet} size="side" />)
      const dur = container.querySelector('animateTransform').getAttribute('dur')
      unmount()
      return dur
    })
    expect(new Set(durations).size).toBe(PET_IDS.length - 0)
  })
})
