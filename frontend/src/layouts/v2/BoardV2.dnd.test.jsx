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
import { render, screen, cleanup, within, fireEvent, waitFor, act } from '@testing-library/react';
import {
  BoardV2,
  BOARD_DRAG_LONG_PRESS_MS,
  BOARD_DRAG_TOLERANCE_PX,
} from './BoardV2.jsx';

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
      // 'manipulation', NOT 'none'. dnd-kit leaves native scrolling to the
      // browser during the hold and only blocks it once the drag arms, so this
      // property alone decides whether a SWIPE scrolls: with 'none' a swipe on
      // the header would neither scroll nor (past the tolerance) grab. See
      // SortableBoardColumn.jsx.
      expect(header.style.touchAction).toBe('manipulation');
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
  // synthesised event that dnd-kit's MouseSensor never sees. A real press is
  // mousedown → mouseup → click, and the sensor listens to the first of those
  // — so this is the sequence that proves the 6px threshold is what keeps the
  // button usable.
  //
  // ⚠️ MOUSE events, not pointer events, and that is not cosmetic. The board
  // registers MouseSensor (see `boardDragSensors` in BoardV2), which does not
  // listen to pointer events at all — so a pointerdown here would reach no
  // sensor, and "no drag armed" would hold trivially, for the wrong reason.
  // The positive control at the end of this file uses the same events, which
  // is what gives these "no drag" assertions their teeth.
  it('lets a real press on "⋯" through without arming a drag', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const trigger = screen.getByLabelText('Ações da coluna A Fazer');

    fireEvent.mouseDown(trigger, { button: 0, clientX: 40, clientY: 10 });
    // 3px of drift — inside the 6px the MouseSensor needs, so the press stays
    // a click.
    fireEvent.mouseMove(document, { clientX: 43, clientY: 10 });
    fireEvent.mouseUp(trigger, { button: 0, clientX: 43, clientY: 10 });
    fireEvent.click(trigger, { button: 0, clientX: 43, clientY: 10 });

    // The click did its job...
    expect(screen.getByTestId('board-column-menu')).toBeTruthy();
    // ...and no drag came along with it.
    expect(screen.queryByTestId('board-v2-drag-overlay')).toBeNull();
  });

  it('does not arm a drag from a press on the header that barely drifts', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const header = screen.getByTestId('board-v2-col-header-a_fazer');

    // Mouse events — see the note on the "⋯" test above.
    fireEvent.mouseDown(header, { button: 0, clientX: 120, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 124, clientY: 12 });
    fireEvent.mouseUp(header, { button: 0, clientX: 124, clientY: 12 });

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
      // 'manipulation', NOT 'none' — and it matters MORE here than on the
      // header. Cards cover most of a column body's scrollable area, so with
      // 'none' a swipe starting on any card could neither scroll the column nor
      // (past the tolerance) grab the card: touch scrolling would be dead.
      // 'manipulation' lets the swipe pan natively, cancelling the pickup,
      // while a still hold arms the drag. See SortableBoardCard.jsx.
      expect(node.style.touchAction).toBe('manipulation');
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
    // A real press is mousedown → mouseup → click, and the sensor listens to
    // the first of those. Only with the REAL providers is there a listener to
    // out-compete (the passthrough-mocked file gets an empty activator list,
    // where a click "passes" for the wrong reason). MOUSE events, not pointer
    // events, for the reason given on the "⋯" test above.
    fireEvent.mouseDown(trigger, { button: 0, clientX: 40, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 43, clientY: 10 });
    fireEvent.mouseUp(trigger, { button: 0, clientX: 43, clientY: 10 });
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

  // SANITY RANGE for the touch timing — deliberately a range, not the value.
  //
  // The BEHAVIOUR is guarded by the real touch tests further down (a still
  // hold arms at exactly this delay and not a millisecond before; a tap does
  // not arm; a swipe past the tolerance cancels). Those follow the constant
  // wherever it is set. What they cannot catch is a value that is absurd in
  // itself, so that is all this checks.
  //
  // It is a range on purpose. An earlier version of this test pinned `>= 500`
  // on the grounds that "280 was too eager for scrolling" — a diagnosis that
  // turned out to be WRONG: the delay was never read on touch at all until
  // the sensor fix (see `boardDragSensors` in BoardV2). 500 is therefore the
  // first value ever tested on a real tablet, and Bruno may well want it
  // lower once it genuinely applies. A floor built on the wrong reason would
  // block that retune while claiming to protect it.
  it('keeps the touch timing inside a sane range', () => {
    // A tap lands and lifts in roughly 100-200ms. Below this, a slow tap could
    // grab a card, and "hold to pick up" would stop being a distinct gesture.
    expect(BOARD_DRAG_LONG_PRESS_MS).toBeGreaterThanOrEqual(250);
    // Above this, picking a card up starts to feel broken rather than careful.
    expect(BOARD_DRAG_LONG_PRESS_MS).toBeLessThanOrEqual(800);
    // The slop allowed during the hold is what separates finger tremor from an
    // intended swipe: a real scroll clears it almost immediately and cancels
    // the pickup (dnd-kit calls handleCancel past this distance).
    expect(BOARD_DRAG_TOLERANCE_PX).toBeGreaterThan(0);
    expect(BOARD_DRAG_TOLERANCE_PX).toBeLessThanOrEqual(12);
  });

  // The pickup animation, asserted where it can honestly be asserted. jsdom
  // has no layout or animation engine, so the MOVEMENT is unobservable — but
  // the stylesheet and the class that drives it are, and those are what a
  // regression would delete.
  it('ships the lift keyframes the pickup animation depends on', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const css = [...document.querySelectorAll('style')].map((el) => el.textContent).join('\n');

    expect(css).toContain('@keyframes v2-drag-lift');
    // The two halves of "lifted off the table": it moves, and its shadow
    // blooms. Both are what the finger cannot cover.
    expect(css).toMatch(/translateY\(-6px\)/);
    expect(css).toMatch(/box-shadow:\s*var\(--v2-shadow-lg\)/);
    // `both`, so the card STAYS lifted for the whole drag instead of settling
    // back after 140ms.
    expect(css).toMatch(/animation:\s*v2-drag-lift[^;]*both/);
    // The phase-2 flash must survive sharing the stylesheet.
    expect(css).toContain('@keyframes v2-column-flash');
  });

  it('keeps the pickup affordance under prefers-reduced-motion, minus the motion', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const css = [...document.querySelectorAll('style')].map((el) => el.textContent).join('\n');
    const reducedMotionBlock = css.slice(css.indexOf('prefers-reduced-motion'));

    // Reduced motion means "do not animate", NOT "do not tell me I picked
    // something up" — the end state is applied directly instead.
    expect(reducedMotionBlock).toMatch(/\.v2-drag-lift\s*{[^}]*animation:\s*none/);
    expect(reducedMotionBlock).toMatch(/\.v2-drag-lift\s*{[^}]*translateY\(-6px\)/);
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
  // -- THE TOUCH BUG: a swipe on a tablet armed a drag immediately -----------
  //
  // Bruno's report: "I scroll the board and the card comes along, without even
  // holding". Root cause, verified in the dnd-kit source: the board registered
  // PointerSensor, whose activator accepts any primary button-0 pointerdown and
  // never checks `pointerType` — so it accepted TOUCH. dnd-kit lets only the
  // FIRST accepting sensor own a gesture ("Another sensor is already
  // instantiating"), browsers fire pointerdown before touchstart, and so the
  // TouchSensor carrying the hold delay was never instantiated at all. A swipe
  // cleared PointerSensor's 6px distance at once and dragged the card.
  //
  // This replays what a finger actually sends — a touch-typed primary
  // pointerdown, then a long swipe — and asserts no drag comes of it. Against
  // the old sensor list this test FAILS: it is the regression guard for the fix,
  // not a restatement of it.
  //
  // Placed before the positive control because it must not follow a completed
  // drag (see that test's note on the click suppressor) — and it arms nothing
  // itself, so it leaves no suppressor behind.
  it('does not let a touch swipe arm a drag through the pointer events it fires', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const card = screen.getByTestId('board-v2-card-1');
    fireEvent.pointerDown(card, {
      button: 0, clientX: 40, clientY: 40, pointerId: 7, isPrimary: true, pointerType: 'touch',
    });
    // A long, fast swipe: 200px, far past the old 6px pointer threshold.
    fireEvent.pointerMove(document, { clientX: 40, clientY: 240, pointerId: 7, pointerType: 'touch' });

    expect(screen.queryByTestId('board-v2-card-drag-overlay')).toBeNull();

    fireEvent.pointerUp(document, { clientX: 40, clientY: 240, pointerId: 7, pointerType: 'touch' });
  });

  it('does not let a touch swipe on a column header arm a column drag either', () => {
    // Same bug, other drag surface — the column reorder shared the sensor list.
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const header = screen.getByTestId('board-v2-col-header-a_fazer');
    fireEvent.pointerDown(header, {
      button: 0, clientX: 10, clientY: 10, pointerId: 8, isPrimary: true, pointerType: 'touch',
    });
    fireEvent.pointerMove(document, { clientX: 220, clientY: 10, pointerId: 8, pointerType: 'touch' });

    expect(screen.queryByTestId('board-v2-drag-overlay')).toBeNull();

    fireEvent.pointerUp(document, { clientX: 220, clientY: 10, pointerId: 8, pointerType: 'touch' });
  });

  // -- the TOUCH path, now that the TouchSensor really owns it --------------
  //
  // Driven with real TouchEvents: jsdom constructs genuine `TouchEvent`
  // instances carrying `touches[0].clientX/Y` (probed before relying on it),
  // which is exactly what dnd-kit's `isTouchEvent` / `getEventCoordinates`
  // read. Two details that are easy to get wrong:
  //
  //   - move and end go to the SAME ELEMENT as the start. TouchSensor, unlike
  //     Mouse/PointerSensor, attaches its listeners to the touch target rather
  //     than the document (AbstractPointerSensor -> getEventListenerTarget).
  //   - only setTimeout/clearTimeout are faked, and only AFTER the first
  //     render. That is precisely what the delay constraint uses
  //     (`setTimeout(handleStart, delay)`), and it leaves React's own scheduler
  //     on real time.
  //
  // These two ARM nothing, so they may sit before the positive control. The
  // ones that do arm a touch drag are at the very end of the file.

  function touchAt(x, y) {
    return {
      touches: [{ clientX: x, clientY: y }],
      changedTouches: [{ clientX: x, clientY: y }],
    };
  }

  function releaseTouchAt(x, y) {
    return { touches: [], changedTouches: [{ clientX: x, clientY: y }] };
  }

  it('lets a SWIPE during the hold scroll instead of grabbing the card', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const card = screen.getByTestId('board-v2-card-1');
      fireEvent.touchStart(card, touchAt(40, 40));
      // Past the tolerance well inside the hold: this is a scroll starting.
      fireEvent.touchMove(card, touchAt(40, 40 + BOARD_DRAG_TOLERANCE_PX + 12));
      // Run the clock well past the hold — the pickup must already be dead.
      act(() => { vi.advanceTimersByTime(BOARD_DRAG_LONG_PRESS_MS + 200); });

      expect(screen.queryByTestId('board-v2-card-drag-overlay')).toBeNull();

      fireEvent.touchEnd(card, releaseTouchAt(40, 72));
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not grab on a TAP shorter than the hold', () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const card = screen.getByTestId('board-v2-card-1');
      fireEvent.touchStart(card, touchAt(40, 40));
      act(() => { vi.advanceTimersByTime(BOARD_DRAG_LONG_PRESS_MS - 150); });
      fireEvent.touchEnd(card, releaseTouchAt(40, 40));
      act(() => { vi.advanceTimersByTime(1000); });

      expect(screen.queryByTestId('board-v2-card-drag-overlay')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // POSITIVE CONTROL for the MOUSE path. Must come after every test that
  // CLICKS (see the block below on the click suppressor); the touch drags that
  // arm come after it.
  //
  // MOUSE events since the sensor fix: MouseSensor is what the board registers
  // for the mouse, and it does not listen to pointer events at all. This is
  // what proves the mouse path still arms — without it, the two "touch swipe
  // must not arm" tests just above could be passing only because NOTHING can
  // arm a drag any more, and every "no drag" assertion in this file would be
  // vacuous.
  it('arms a drag when the mouse travels well past the threshold', async () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);

    const header = screen.getByTestId('board-v2-col-header-a_fazer');
    fireEvent.mouseDown(header, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 200, clientY: 10 });

    expect(screen.getByTestId('board-v2-drag-overlay')).toBeTruthy();

    // Release it and WAIT for the release to take — DragOverlay plays a drop
    // animation, so the overlay outlives the mouseup by a few frames.
    fireEvent.mouseUp(document, { clientX: 200, clientY: 10 });
    await waitFor(() =>
      expect(screen.queryByTestId('board-v2-drag-overlay')).toBeNull()
    );
  });

  // -- touch drags that ARM: last in the file, after every clicking test ----
  //
  // These are the positive control for the TOUCH path — the half of Bruno's
  // requirement the regression tests above cannot show on their own. "A swipe
  // does not grab" would also hold if touch could not grab AT ALL; these prove
  // a still hold still does, which is what makes those assertions mean
  // something.

  it('arms a card drag after a STILL hold, with no movement at all', async () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const card = screen.getByTestId('board-v2-card-1');
    try {
      fireEvent.touchStart(card, touchAt(40, 40));

      // One millisecond short of the hold: not yet. This is what pins that it
      // is the TIMER arming the drag, and not the touch itself — the old bug
      // was precisely a touch that armed with no wait.
      act(() => { vi.advanceTimersByTime(BOARD_DRAG_LONG_PRESS_MS - 1); });
      expect(screen.queryByTestId('board-v2-card-drag-overlay')).toBeNull();

      // The hold completes with the finger never having moved — and the card
      // is picked up. Bruno's "segurar parado por meio segundo arma".
      act(() => { vi.advanceTimersByTime(1); });
      expect(screen.getByTestId('board-v2-card-drag-overlay')).toBeTruthy();

      fireEvent.touchEnd(card, releaseTouchAt(40, 40));
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() =>
      expect(screen.queryByTestId('board-v2-card-drag-overlay')).toBeNull()
    );
  });

  it('tolerates finger tremor inside the tolerance during the hold', async () => {
    render(<BoardV2 projects={projects} selectedClienteId="projA" />);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const card = screen.getByTestId('board-v2-card-2');
    try {
      fireEvent.touchStart(card, touchAt(40, 40));
      // ~3.6px of drift: a finger resting, not a finger swiping.
      fireEvent.touchMove(card, touchAt(43, 42));
      act(() => { vi.advanceTimersByTime(BOARD_DRAG_LONG_PRESS_MS); });

      expect(screen.getByTestId('board-v2-card-drag-overlay')).toBeTruthy();

      fireEvent.touchEnd(card, releaseTouchAt(43, 42));
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() =>
      expect(screen.queryByTestId('board-v2-card-drag-overlay')).toBeNull()
    );
  });
});
