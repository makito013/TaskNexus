// frontend/src/layouts/v2/BoardV2.dnd.test.jsx
// Smoke test for the REAL dnd-kit provider tree (task #43, phase 2).
//
// Why a separate file: BoardV2.test.jsx replaces `DndContext` with a
// passthrough so it can invoke `onDragEnd` with a synthetic event. That seam
// is necessary — a real drag cannot be driven in jsdom — but it means the
// actual `DndContext` / `SortableContext` / `useSortable` / `DragOverlay` tree
// never mounts in that file. A provider misconfiguration (a missing context, a
// bad `items` prop, a hook called outside its provider) would crash the board
// in the browser and leave every test in this suite green.
//
// Module mocks are per-file in vitest, so this file gets the real library.
// It asserts only what jsdom can honestly observe: that the tree MOUNTS and
// still renders the board. It deliberately does NOT try to simulate a drag —
// dnd-kit's sensors need pointer capture and real `getBoundingClientRect`
// values, and jsdom provides neither.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import { BoardV2 } from './BoardV2.jsx';

// Two cards in one column so phase 3's card sortables really mount here — an
// empty board would let a misconfigured card `SortableContext` pass unnoticed,
// which is exactly the class of bug this file exists to catch.
const CARDS = [
  { id: 1, titulo: 'Card 1', projeto_id: 'projA', status: 'a_fazer', ultima_atualizacao_por: 'bruno' },
  { id: 2, titulo: 'Card 2', projeto_id: 'projA', status: 'a_fazer', ultima_atualizacao_por: 'bruno' },
];

const moveCard = vi.fn().mockResolvedValue({});
const setCardDragActive = vi.fn();

vi.mock('../../hooks/useCards.js', () => ({
  useCards: () => ({
    cards: CARDS,
    createCard: vi.fn(),
    updateCard: vi.fn(),
    moveCard,
    setCardDragActive,
    deleteCard: vi.fn(),
    uploadCardImage: vi.fn(),
    deleteCardImage: vi.fn(),
    previewClearFinished: vi.fn(),
    clearFinished: vi.fn(),
  }),
}));

const COLUMNS = [
  { slug: 'a_fazer', label: 'A Fazer', position: 1, is_done: false },
  { slug: 'em_andamento', label: 'Em Andamento', position: 2, is_done: false },
  { slug: 'feito', label: 'Feito', position: 3, is_done: true },
];

vi.mock('../../hooks/useColumns.js', () => ({
  useColumns: () => ({
    columns: COLUMNS,
    loading: false,
    doneSlug: 'feito',
    firstSlug: 'a_fazer',
    createColumn: vi.fn(),
    renameColumn: vi.fn(),
    reorderColumns: vi.fn(),
    setDoneColumn: vi.fn(),
    deleteColumn: vi.fn(),
  }),
}));

const projects = [
  { id: 'projA', nome: 'Projeto A', path: '/tmp/a', agentes: [], sub_projetos: [] },
];

beforeEach(() => {
  window.matchMedia = window.matchMedia || (() => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('BoardV2 - real dnd-kit provider tree', () => {
  it('mounts without throwing and still renders every column', () => {
    expect(() => {
      render(<BoardV2 projects={projects} selectedClienteId="projA" />);
    }).not.toThrow();

    for (const column of COLUMNS) {
      expect(screen.getByTestId(`board-v2-col-${column.slug}`)).toBeTruthy();
    }
  });

  // The dedicated ⠿ grip is gone: the activator is now the whole header bar
  // (Bruno's call after testing phase 2 live — grab anywhere, like Jira).
  it('makes the whole header bar the drag activator', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    // Proof the REAL provider mounted, now that the header carries none of
    // dnd-kit's attributes: DndContext renders its own live region into the
    // tree. Matched on role + aria-live rather than the `DndLiveRegion-0` id,
    // which is an internal counter.
    expect(document.querySelector('[role="status"][aria-live="assertive"]'))
      .toBeTruthy();

    for (const column of COLUMNS) {
      const header = screen.getByTestId(`board-v2-col-header-${column.slug}`);
      // The human label, never the slug: "Em Andamento", not "em_andamento".
      expect(header.getAttribute('aria-label'))
        .toBe(`Coluna ${column.label} — arraste para reordenar`);
      // touchAction must stay 'none', or the browser claims the gesture as a
      // scroll before the 280ms long press ever arms.
      expect(header.style.touchAction).toBe('none');
      // The header keeps its own layout styles — the drag props are MERGED
      // into them, not substituted for them.
      expect(header.style.display).toBe('flex');
      expect(header.style.cursor).toBe('grab');
    }
  });

  it('keeps the dedicated grip element gone', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    for (const column of COLUMNS) {
      expect(screen.queryByTestId(`board-v2-grip-${column.slug}`)).toBeNull();
    }
  });

  it('keeps the column menu reachable with the providers mounted', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    expect(screen.getByLabelText('Ações da coluna A Fazer')).toBeTruthy();
    // The done affordance from phase 1 survives the wrapper element.
    const doneColumn = screen.getByTestId('board-v2-col-feito');
    expect(within(doneColumn).getByLabelText('Coluna concluída')).toBeTruthy();
  });

  // The mitigation that makes the whole design work, asserted where it can
  // ACTUALLY be asserted. The sibling file mocks DndContext with a passthrough,
  // so `useSortable` there falls back to dnd-kit's default internal context
  // with an EMPTY `activators` list: the header gets no listeners, and a click
  // "passes" because nothing is competing for it. Only here, with the real
  // providers, is there a real listener to out-compete.
  //
  // The event sequence matters too: `fireEvent.click` alone is a single
  // synthesised event that dnd-kit's PointerSensor never sees. A real press is
  // pointerdown → pointerup → click, and the sensor listens to the first of
  // those — so this is the sequence that proves the 6px threshold is what
  // keeps the button usable.
  it('lets a real press on "⋯" through without arming a drag', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const trigger = screen.getByLabelText('Ações da coluna A Fazer');

    fireEvent.pointerDown(trigger, { button: 0, clientX: 40, clientY: 10, pointerId: 1, isPrimary: true });
    // 3px of drift — inside the 6px the PointerSensor needs, so the press
    // stays a click.
    fireEvent.pointerMove(document, { clientX: 43, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(trigger, { button: 0, clientX: 43, clientY: 10, pointerId: 1 });
    fireEvent.click(trigger, { button: 0, clientX: 43, clientY: 10 });

    // The click did its job...
    expect(screen.getByTestId('board-column-menu')).toBeTruthy();
    // ...and no drag came along with it.
    expect(screen.queryByTestId('board-v2-drag-overlay')).toBeNull();
  });

  it('does not arm a drag from a press on the header that barely drifts', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const header = screen.getByTestId('board-v2-col-header-a_fazer');

    fireEvent.pointerDown(header, { button: 0, clientX: 120, clientY: 10, pointerId: 1, isPrimary: true });
    fireEvent.pointerMove(document, { clientX: 124, clientY: 12, pointerId: 1 });
    fireEvent.pointerUp(header, { button: 0, clientX: 124, clientY: 12, pointerId: 1 });

    expect(screen.queryByTestId('board-v2-drag-overlay')).toBeNull();
  });

  // QA: the sortable wrapper is a NEW flex child between the scroller and the
  // column. The scroller is `align-items: flex-start`, so a flex item is NOT
  // stretched — it sizes to its content — and the column inside resolves its
  // own `height: 100%` against this wrapper. Drop the wrapper's definite height
  // and that percentage chain breaks: every column collapses to the height of
  // its cards. jsdom has no layout engine, so the computed height is
  // unobservable — but the DECLARATION is, and that is what a regression would
  // remove. Same technique the touchAction assertion above already relies on.
  it('gives the sortable wrapper the definite height the column sizes against', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    for (const column of COLUMNS) {
      const wrapper = screen.getByTestId(`board-v2-col-${column.slug}`).parentElement;
      expect(wrapper.style.height).toBe('100%');
      // The column must not be squeezed below its 300px in a crowded row.
      expect(wrapper.style.flexShrink).toBe('0');
    }
  });

  // The QA pinned a real a11y trap here: `useSortable` puts role="button" and
  // tabindex=0 on its activator, but BoardV2 passes an explicit `sensors` list
  // (Pointer + Touch) that replaces dnd-kit's defaults and registers no
  // KeyboardSensor — so the activator sat in the tab order announcing itself
  // as a draggable control no key could operate. Their comment asked for this
  // test to be the one that says the trap is gone.
  //
  // It is gone, by removal rather than by adding a KeyboardSensor: the
  // activator became the header BAR, and `role="button"`/`tabIndex` are
  // stripped from dnd-kit's attributes there — a container holding the "⋯"
  // button must not itself claim to be a button.
  //
  // ⚠️ What replaced it is NOT a keyboard path: the ◀▶ arrows were removed at
  // Bruno's request, so today nothing reorders a column from the keyboard.
  // Accepted knowingly; the fix is a KeyboardSensor, which is out of scope.
  it('keeps the drag activator OUT of the tab order, with no keyboard trap', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const header = screen.getByTestId('board-v2-col-header-a_fazer');
    expect(header.getAttribute('tabindex')).toBeNull();
    // `group` names the bar without putting it in the tab order and without
    // impersonating the button it contains — unlike dnd-kit's `button`.
    expect(header.getAttribute('role')).toBe('group');

    fireEvent.keyDown(header, { key: ' ', code: 'Space' });
    fireEvent.keyDown(header, { key: 'Enter', code: 'Enter' });

    // No drag was armed — and this asserts the overlay itself, not a prefix
    // count that any new testid could satisfy by accident.
    expect(screen.queryByTestId('board-v2-drag-overlay')).toBeNull();
  });

  // The QA's finding, now FIXED. It used to read: dnd-kit's attributes left
  // `aria-roledescription`/`aria-disabled` on a roleless <div> (role-gated, so
  // inert) plus an `aria-describedby` pointing at English instructions for a
  // space-bar/arrow-key drag this build does not implement. The inert pair was
  // dead markup; the describedby was the live half, because aria-describedby
  // deliberately exposes `display: none` content.
  //
  // All of dnd-kit's attributes are dropped now — only its `listeners` are
  // kept — and the name we put there ourselves is made real by `role="group"`,
  // since ARIA 1.2 would otherwise drop it for exactly the same role-gating
  // reason. Both halves are asserted here: nothing false, and the truthful
  // name actually reaching AT.
  it('exposes no dnd-kit ARIA on the header, and names it in a way AT will use', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const header = screen.getByTestId('board-v2-col-header-a_fazer');

    expect(header.getAttribute('aria-roledescription')).toBeNull();
    expect(header.getAttribute('aria-disabled')).toBeNull();
    expect(header.getAttribute('aria-describedby')).toBeNull();

    // The name, and the role that keeps it from being discarded. A regression
    // that drops the role would silently make the label dead markup again, so
    // the two are asserted together on purpose.
    expect(header.getAttribute('role')).toBe('group');
    expect(header.getAttribute('aria-label'))
      .toBe('Coluna A Fazer — arraste para reordenar');
    // Reachable through the accessibility tree, not just present as a string.
    expect(screen.getByRole('group', { name: 'Coluna A Fazer — arraste para reordenar' }))
      .toBe(header);
  });

  // dnd-kit mounts its live region unconditionally and announces during
  // POINTER drags too, not just keyboard ones — so its default English
  // strings would be spoken on a pt-BR board. They are replaced, and the
  // instructions now describe the interaction this build actually has.
  it('replaces dnd-kit\'s English screen-reader instructions with truthful pt-BR', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const instructions = [...document.querySelectorAll('div')]
      .map((el) => el.textContent)
      .join(' ');

    expect(instructions).toMatch(/arraste o cabeçalho da coluna/);
    // The default text promises a space-bar/arrow-key drag that does not exist
    // here: the sensor list is Pointer + Touch, with no KeyboardSensor.
    expect(instructions).not.toMatch(/press the space bar/i);
  });

  it('renders no drag overlay while nothing is being dragged', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    // The overlay is portaled to document.body; idle, it must contribute
    // nothing — a stray empty box there would sit over the whole app.
    // Asserted on the overlay's OWN testid: the previous prefix count
    // (`[data-testid^="board-v2-col-"]`) was vacuous, and in fact silently
    // started matching the new `board-v2-col-header-*` nodes.
    expect(screen.queryByTestId('board-v2-drag-overlay')).toBeNull();
  });

  // -- phase 3: the card sortables, with the real providers mounted ---------

  it('makes the whole card the drag surface, with the touch package applied', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    for (const card of CARDS) {
      const node = screen.getByTestId(`board-v2-card-${card.id}`);
      // touchAction must stay 'none', or the column body claims the gesture as
      // a vertical scroll before the 280ms long press ever arms — and a card
      // lives inside a scrolling body, so this matters more here than on the
      // column header.
      expect(node.style.touchAction).toBe('none');
      expect(node.style.cursor).toBe('grab');
      expect(node.style.webkitUserSelect || node.style.WebkitUserSelect).toBe('none');
      // The card keeps its own layout styles — the drag props are MERGED into
      // them, not substituted for them.
      expect(node.style.display).toBe('flex');
      // Named for AT, with the `role="group"` that keeps ARIA 1.2 from
      // discarding the label (same pairing as the column header).
      expect(node.getAttribute('role')).toBe('group');
      expect(node.getAttribute('aria-label'))
        .toBe(`Card ${card.titulo} — arraste para reposicionar`);
    }
  });

  it('exposes no dnd-kit ARIA on the card either', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const node = screen.getByTestId('board-v2-card-1');
    // The live one of the three: it points at dnd-kit's hidden English
    // instructions for a space-bar drag this build does not implement.
    expect(node.getAttribute('aria-describedby')).toBeNull();
    expect(node.getAttribute('aria-roledescription')).toBeNull();
    expect(node.getAttribute('tabindex')).toBeNull();
  });

  it('keeps the card title and the status select clickable inside the drag surface', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const trigger = screen.getByText('Card 1');
    // A real press is pointerdown → pointerup → click, and the sensor listens
    // to the first of those. Only with the REAL providers is there a listener
    // to out-compete (the passthrough-mocked file gets an empty activator
    // list, where a click "passes" for the wrong reason).
    fireEvent.pointerDown(trigger, { button: 0, clientX: 40, clientY: 10, pointerId: 1, isPrimary: true });
    fireEvent.pointerMove(document, { clientX: 43, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(trigger, { button: 0, clientX: 43, clientY: 10, pointerId: 1 });
    fireEvent.click(trigger, { button: 0, clientX: 43, clientY: 10 });

    // The click opened the edit modal...
    expect(screen.getByText('Editar Card')).toBeTruthy();
    // ...and no drag came along with it.
    expect(screen.queryByTestId('board-v2-card-drag-overlay')).toBeNull();
  });

  it('gives every column body a card dropzone, so an empty column can receive one', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    // `em_andamento` holds no cards at all — its SortableContext registers no
    // item, so the body's own droppable is the ONLY thing a card could be
    // dropped onto there.
    expect(screen.getByTestId('board-v2-col-body-em_andamento')).toBeTruthy();
    for (const column of COLUMNS) {
      expect(screen.getByTestId(`board-v2-col-body-${column.slug}`)).toBeTruthy();
    }
  });

  it('announces cards by title and mentions both drags in the instructions', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const text = [...document.querySelectorAll('div')].map((el) => el.textContent).join(' ');
    // The column half, unchanged from phase 2.
    expect(text).toMatch(/arraste o cabeçalho da coluna/);
    // The card half, plus the keyboard route that DOES exist for a card.
    expect(text).toMatch(/arraste o card/);
    expect(text).toMatch(/seletor de coluna no pé do card/);
  });

  it('renders no card drag overlay and no drop indicator while idle', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    expect(screen.queryByTestId('board-v2-card-drag-overlay')).toBeNull();
    expect(screen.queryByTestId('board-v2-drop-indicator')).toBeNull();
  });

  // POSITIVE CONTROL, and it must stay LAST in this file.
  //
  // Why it exists: "no overlay appeared" proves nothing on its own. A press
  // that never travels produces no drag no matter WHAT the threshold is —
  // measured, by setting BOARD_DRAG_POINTER_DISTANCE_PX to 0 and watching the
  // mitigation tests above still pass. This test is what gives them teeth: it
  // pins that a move PAST the threshold really does arm a drag here, so the
  // ones that assert "no drag" are asserting a difference rather than a
  // constant.
  //
  // Why last: dnd-kit installs a capture-phase click suppressor on the
  // DOCUMENT when a drag ends, to swallow the click that would otherwise
  // follow a drop. That listener outlives React's `cleanup()`, so running a
  // real drag before the "⋯" click test makes that test fail for a reason
  // that has nothing to do with the code under test. Keeping the only
  // completed drag at the end of the file sidesteps it, and this note is here
  // so nobody "tidies" it back up to the top.
  it('arms a drag when the pointer travels well past the threshold', async () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const header = screen.getByTestId('board-v2-col-header-a_fazer');
    fireEvent.pointerDown(header, { button: 0, clientX: 10, clientY: 10, pointerId: 1, isPrimary: true });
    fireEvent.pointerMove(document, { clientX: 200, clientY: 10, pointerId: 1 });

    expect(screen.getByTestId('board-v2-drag-overlay')).toBeTruthy();

    // Release it and WAIT for the release to take — DragOverlay plays a drop
    // animation, so the overlay outlives the pointerup by a few frames.
    fireEvent.pointerUp(document, { clientX: 200, clientY: 10, pointerId: 1 });
    await waitFor(() =>
      expect(screen.queryByTestId('board-v2-drag-overlay')).toBeNull()
    );
  });
});
