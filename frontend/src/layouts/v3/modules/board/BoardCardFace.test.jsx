import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ToastHost from '../../components/Toast/ToastHost.jsx'
import BoardCardFace, { avatarInitials, plainDescription } from './BoardCardFace.jsx'
import { buildRegistryIndex } from '../projects/registryIndex.js'
import { card, registry } from './boardFixtures.js'

const TODAY = new Date(2026, 10, 26)
const index = registry()

function face(extra = {}, props = {}) {
  return render(
    <ToastHost>
      <BoardCardFace card={card(128, 'Pessoal/tn-sandbox', extra)} registry={index} doneSlug="feito" today={TODAY} {...props} />
    </ToastHost>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('BoardCardFace: content and order', () => {
  it('shows the number, the place chips and the title as plain text, not a button', () => {
    face({ titulo: 'Corrigir o login' })
    expect(screen.getByRole('button', { name: 'Copiar número do card 128' }).textContent).toBe('#128')
    expect(screen.getByText('Pessoal')).toBeTruthy()
    expect(screen.getByText('tn-sandbox')).toBeTruthy()
    const title = screen.getByRole('heading', { name: 'Corrigir o login' })
    expect(title.closest('button')).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('puts number, chips, priority, type, title, description, avatar and due date in this order', () => {
    const { container } = face({ prioridade: 'alta', tipo: 'bug', descricao: 'Texto', prazo: '2026-12-12', questions: [{ answer: null }] })
    container.querySelector('.v3-board-card__summary').remove()
    const text = container.textContent
    const positions = ['#128', 'Pessoal', 'tn-sandbox', '1 pergunta', 'BUG', 'Card 128', 'Texto', 'BR', '12 dez']
      .map((part) => text.indexOf(part))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('hides the project chip when the filter already names the project, never the workspace one', () => {
    face({}, { hideProject: true })
    expect(screen.queryByText('tn-sandbox')).toBeNull()
    expect(screen.getByText('Pessoal')).toBeTruthy()
  })

  it('a card at the workspace root has a workspace chip only', () => {
    render(<BoardCardFace card={card(1, 'Pessoal')} registry={index} doneSlug="feito" today={TODAY} />)
    expect(screen.getByText('Pessoal')).toBeTruthy()
    expect(screen.queryByText('Do workspace')).toBeNull()
  })

  it('places a stray card under "Sem workspace"', () => {
    render(<BoardCardFace card={card(4, 'NewCo/x')} registry={index} doneSlug="feito" today={TODAY} />)
    expect(screen.getByText('Sem workspace')).toBeTruthy()
    expect(screen.getByText('NewCo/x')).toBeTruthy()
  })

  it('a long title without spaces is still the heading text', () => {
    const long = 'x'.repeat(300)
    face({ titulo: long })
    expect(screen.getByRole('heading', { name: long })).toBeTruthy()
  })
})

describe('BoardCardFace: priority, type, questions', () => {
  it.each([
    ['muito_baixa', 'Prioridade: Muito baixa'],
    ['baixa', 'Prioridade: Baixa'],
    ['media', 'Prioridade: Média'],
    ['alta', 'Prioridade: Alta'],
    ['muito_alta', 'Prioridade: Muito alta'],
  ])('shows %s with a text label', (level, label) => {
    face({ prioridade: level })
    const icon = screen.getByRole('img', { name: label })
    expect(icon.getAttribute('title')).toBe(label)
  })

  it('draws a different number of filled bars for the levels that differ', () => {
    const filled = (level) => {
      const { container, unmount } = face({ prioridade: level })
      const count = container.querySelectorAll('.v3-board-priority__bar:not(.v3-board-priority__bar--empty)').length
      unmount()
      return count
    }
    expect([filled('muito_baixa'), filled('baixa'), filled('media'), filled('alta'), filled('muito_alta')])
      .toEqual([1, 1, 2, 3, 3])
  })

  it('"muito alta" adds the urgent mark, "alta" does not', () => {
    const { container, unmount } = face({ prioridade: 'muito_alta' })
    expect(container.querySelector('.v3-board-priority--urgent')).not.toBeNull()
    unmount()
    const second = face({ prioridade: 'alta' })
    expect(second.container.querySelector('.v3-board-priority--urgent')).toBeNull()
  })

  it('a card without priority leaves no empty slot', () => {
    const { container } = face({ prioridade: null })
    expect(container.querySelector('.v3-board-priority')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it.each([['bug', 'BUG'], ['hotfix', 'HOTFIX'], ['historia', 'HISTÓRIA']])('shows the type %s', (tipo, text) => {
    face({ tipo })
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('counts only unanswered questions, singular and plural', () => {
    const chipText = (container) => container.querySelector('.v3-chip--state')?.textContent
    const first = face({ questions: [{ answer: null }, { answer: 'sim' }] })
    expect(chipText(first.container)).toBe('1 pergunta')
    first.unmount()
    const second = face({ questions: [{ answer: null }, { answer: '' }, { answer: 'x' }] })
    expect(chipText(second.container)).toBe('2 perguntas')
  })

  it('shows no question chip when everything is answered', () => {
    face({ questions: [{ answer: 'ok' }] })
    expect(screen.queryByText(/pergunta/)).toBeNull()
  })
})

describe('BoardCardFace: due date', () => {
  it('is overdue with an icon and the word in the label, not only a colour', () => {
    const { container } = face({ prazo: '2026-11-01' })
    const due = screen.getByLabelText('Prazo 1 nov, atrasado')
    expect(due.className).toContain('v3-board-card__due--overdue')
    expect(container.querySelector('.v3-board-card__clock')).not.toBeNull()
  })

  it('a future due date is neutral', () => {
    const { container } = face({ prazo: '2026-12-12' })
    expect(screen.getByLabelText('Prazo 12 dez').className).not.toContain('overdue')
    expect(container.querySelector('.v3-board-card__clock')).toBeNull()
  })

  it('a late date in the done column is neutral: it was delivered', () => {
    face({ prazo: '2026-11-01', status: 'feito' })
    expect(screen.getByLabelText('Prazo 1 nov').className).not.toContain('overdue')
  })

  it('a card with no due date shows none', () => {
    face({ prazo: null })
    expect(screen.queryByLabelText(/^Prazo/)).toBeNull()
  })

  it('summarises priority, due date and questions for the screen reader', () => {
    face({ prioridade: 'alta', prazo: '2026-11-01', questions: [{ answer: null }] })
    const article = screen.getByRole('article')
    const summary = document.getElementById(article.getAttribute('aria-describedby'))
    expect(summary.textContent).toBe('Prioridade Alta, prazo 1 nov, atrasado, 1 pergunta')
  })
})

describe('BoardCardFace: copy the number', () => {
  it('copies the bare number (no hash) and says "Copiado."', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.assign(navigator, { clipboard: { writeText } })
    face()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar número do card 128' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('128'))
    expect((await screen.findByRole('status')).textContent).toContain('Copiado.')
  })

  it('says it failed when nothing could copy', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    document.execCommand = vi.fn(() => false)
    face()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar número do card 128' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(within(screen.getByRole('alert')).getByText('Não consegui copiar.')).toBeTruthy()
  })
})

describe('plainDescription and avatarInitials', () => {
  it('drops the Markdown marks and never produces HTML', () => {
    expect(plainDescription('# Título\n\n- **negrito** e `código`\n[link](http://x.test) ![img](a.png)'))
      .toBe('Título negrito e código link img')
    expect(plainDescription('<script>alert(1)</script>')).toBe('<script>alert(1)</script>')
    expect(plainDescription(null)).toBe('')
  })

  it('renders a hostile description as text', () => {
    const { container } = face({ descricao: '<img src=x onerror=alert(1)>' })
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.v3-board-card__description').textContent).toBe('<img src=x onerror=alert(1)>')
  })

  it.each([
    [undefined, 'BR'], ['bruno', 'BR'], ['agente:claude', 'CL'], ['agente:x', 'X'], ['codex', 'CO'], ['agente:', '?'],
  ])('initials of %s', (who, expected) => {
    expect(avatarInitials(who)).toBe(expected)
  })
})

describe('BoardCardFace: same name for project and workspace', () => {
  it('shows the name once when the root project is called like its workspace', () => {
    const legacy = buildRegistryIndex({
      seeded: null,
      workspaces: [{
        id: 2, key: 'podesubir', name: 'podesubir', origin: 'seed', archived: false,
        projects: [{ id: 5, key: 'podesubir', name: 'podesubir', origin: 'seed', archived: false, primary_locked: false, folders: [] }],
      }],
    })
    render(<BoardCardFace card={card(9, 'podesubir')} registry={legacy} doneSlug="feito" today={TODAY} />)
    expect(screen.getAllByText('podesubir')).toHaveLength(1)
  })
})
