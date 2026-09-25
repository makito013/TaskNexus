// frontend/src/layouts/v2/TaskDetailModalV2.test.jsx
// Covers the v2-native task detail modal: markdown/HTML segmented control
// (mirrors the v1 TaskDetailModal.test.jsx coverage), real sanitization
// proof (not just "jsdom never runs <script>", which would pass unsanitized
// too), the metadata rail, and which container (CenteredModal/BottomSheet)
// renders per viewport.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TaskDetailModalV2 } from './TaskDetailModalV2.jsx';

afterEach(() => cleanup());

const baseTask = {
  id: 1,
  session_key: 'projA::claude',
  titulo: 'Investigar bug X',
  descricao_markdown: '# Título\n\nAlgum **texto**.',
  descricao_html: null,
  status: 'pending',
  created_at: new Date(2026, 8, 22, 14, 30).getTime() / 1000,
  completed_at: null,
  projeto_id: 'projA',
};

function renderModal(overrides = {}) {
  const props = {
    task: baseTask,
    projects: [],
    onToggle: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(<TaskDetailModalV2 {...props} />), props };
}

describe('TaskDetailModalV2 — descricao_html absent', () => {
  it('does not render the segmented control and shows the markdown content directly', () => {
    renderModal();

    expect(screen.queryByText('Markdown')).toBeNull();
    expect(screen.queryByText('Visualização')).toBeNull();
    expect(screen.getByText('Título')).not.toBeNull();
  });
});

describe('TaskDetailModalV2 — descricao_html present', () => {
  const taskWithHtml = { ...baseTask, descricao_html: '<html><body><h1>Preview</h1></body></html>' };

  it('renders the segmented control with Markdown as the initial active tab, no iframe yet', () => {
    renderModal({ task: taskWithHtml });

    expect(screen.getByText('Markdown')).not.toBeNull();
    expect(screen.getByText('Visualização')).not.toBeNull();
    expect(screen.getByText('Título')).not.toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('renders the HTML preview inside a sandboxed iframe with no allow-* tokens, using srcDoc', () => {
    renderModal({ task: taskWithHtml });

    fireEvent.click(screen.getByText('Visualização'));

    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute('sandbox')).toBe('');
    expect(iframe.srcdoc).toBe(taskWithHtml.descricao_html);
  });
});

describe('TaskDetailModalV2 — markdown sanitization (real proof, not vacuous)', () => {
  // jsdom never executes a <script> inserted via innerHTML, so "alert wasn't
  // called" would pass even without any sanitization at all. The real proof
  // is that the tag is gone from the DOM. A FENCED code block is not a valid
  // fixture for this: `marked` HTML-escapes fenced code content on its own
  // (confirmed directly against this repo's `marked` — a fenced
  // `<script>...</script>` comes out as `&lt;script&gt;...`), so that case
  // would pass even with DOMPurify removed entirely. The raw, unfenced tag
  // below is the case that actually depends on DOMPurify.sanitize.
  it('strips a raw <script> tag embedded directly in the markdown', () => {
    const task = { ...baseTask, descricao_markdown: 'Texto antes\n\n<script>alert(1)</script>\n\nTexto depois' };
    renderModal({ task });

    expect(document.querySelector('script')).toBeNull();
  });

  it('strips inline event handlers such as onerror from an embedded <img>', () => {
    const task = { ...baseTask, descricao_markdown: '<img src="x" onerror="alert(1)">' };
    renderModal({ task });

    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('onerror')).toBeNull();
  });
});

describe('TaskDetailModalV2 — empty description', () => {
  it('shows a friendly empty state for an empty-string descricao_markdown', () => {
    const task = { ...baseTask, descricao_markdown: '' };
    renderModal({ task });

    expect(screen.getByText(/sem descrição/i)).toBeTruthy();
  });

  it('shows the same friendly empty state for a null descricao_markdown', () => {
    const task = { ...baseTask, descricao_markdown: null };
    renderModal({ task });

    expect(screen.getByText(/sem descrição/i)).toBeTruthy();
  });
});

describe('TaskDetailModalV2 — header actions', () => {
  it('calls onToggle with the task when clicking "Marcar concluída" on a pending task', () => {
    const onToggle = vi.fn();
    renderModal({ task: baseTask, onToggle });

    fireEvent.click(screen.getByText('Marcar concluída'));

    expect(onToggle).toHaveBeenCalledWith(baseTask);
  });

  it('shows "Reabrir" and calls onToggle for a done task', () => {
    const onToggle = vi.fn();
    const doneTask = { ...baseTask, status: 'done', completed_at: baseTask.created_at };
    renderModal({ task: doneTask, onToggle });

    fireEvent.click(screen.getByText('Reabrir'));

    expect(onToggle).toHaveBeenCalledWith(doneTask);
  });

  it('calls onClose on Escape (confirms the listener fires through the CenteredModal composition)', () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });
});

describe('TaskDetailModalV2 — metadata rail', () => {
  it('shows "Criada em" formatted and "—" for "Concluída em" on a pending task without completed_at', () => {
    renderModal({ task: baseTask });

    expect(screen.getByText('22/09/2026 14:30')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('shows both dates formatted for a done task', () => {
    const doneTask = {
      ...baseTask,
      status: 'done',
      completed_at: new Date(2026, 8, 23, 9, 5).getTime() / 1000,
    };
    renderModal({ task: doneTask });

    expect(screen.getByText('22/09/2026 14:30')).toBeTruthy();
    expect(screen.getByText('23/09/2026 09:05')).toBeTruthy();
  });

  it('shows cliente/projeto tags resolved via resolveCardTags for a sub-project task', () => {
    const projects = [
      { id: 'cliente1', nome: 'Cliente 1', path: '/tmp/c1', agentes: [], sub_projetos: ['cliente1/sub1'] },
      { id: 'cliente1/sub1', nome: 'Sub 1', path: '/tmp/c1/sub1', agentes: [], sub_projetos: [] },
    ];
    const task = { ...baseTask, projeto_id: 'cliente1/sub1' };
    renderModal({ task, projects });

    expect(screen.getByText('Cliente 1')).toBeTruthy();
    expect(screen.getByText('Sub 1')).toBeTruthy();
  });
});

describe('TaskDetailModalV2 — responsive container', () => {
  // `useMediaQuery` reads `matchMedia(query).matches` on first render, so the
  // stub has to answer for the exact query the component asks about
  // (MOBILE_VIEWPORT_QUERY, '(max-width: 640px)') — same technique as
  // BoardColumnDialogs.responsive.test.jsx.
  function setViewport(isMobile) {
    window.matchMedia = (query) => ({
      matches: isMobile && query === '(max-width: 640px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    });
  }

  beforeEach(() => setViewport(false));
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renders as a CenteredModal on desktop', () => {
    renderModal();

    expect(screen.getByTestId('centered-modal-panel')).toBeTruthy();
    expect(screen.queryByTestId('bottom-sheet-panel')).toBeNull();
  });

  it('renders as a BottomSheet on a phone', () => {
    setViewport(true);
    renderModal();

    expect(screen.getByTestId('bottom-sheet-panel')).toBeTruthy();
    expect(screen.queryByTestId('centered-modal-panel')).toBeNull();
  });

  it('exposes dialog role/accessible name in BottomSheet mode (the component supplies it itself, unlike CenteredModal)', () => {
    setViewport(true);
    renderModal();

    expect(screen.getByRole('dialog', { name: baseTask.titulo })).toBeTruthy();
  });

  it('closes via Escape in BottomSheet mode', () => {
    setViewport(true);
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes via a scrim click in BottomSheet mode', () => {
    setViewport(true);
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.click(screen.getByTestId('bottom-sheet-scrim'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
