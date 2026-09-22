// frontend/src/components/board/SortableBoardDragFeedback.test.jsx
// The "you have picked this up" feedback, for both sortables (task #43, phase
// 3 follow-up).
//
// Why a file of its own, with `useSortable` mocked: `isDragging` is only true
// during a real gesture, and a real dnd-kit gesture cannot be driven in jsdom
// (its sensors need pointer capture and real `getBoundingClientRect` values).
// BoardV2.dnd.test.jsx mounts the real providers but can only reach the
// NOT-dragging state for a card. Stubbing the hook is what makes the dragging
// branch reachable at all.
//
// What this pins is the fix for a concrete complaint from the tablet test: the
// drag arms 280ms after the finger lands, WITHOUT any movement, but every
// signal of that was drawn underneath the finger that caused it. The ring
// asserted below is the part a fingertip cannot cover.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const sortableState = { isDragging: false };

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    setActivatorNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: sortableState.isDragging,
  }),
}));

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}));

const { SortableBoardColumn } = await import('./SortableBoardColumn.jsx');
const { SortableBoardCard } = await import('./SortableBoardCard.jsx');

function renderColumn() {
  return render(
    <SortableBoardColumn slug="a_fazer" label="A Fazer">
      {({ headerDragProps }) => (
        <div data-testid="column-body">
          <div {...headerDragProps} data-testid="column-header">A Fazer</div>
        </div>
      )}
    </SortableBoardColumn>
  );
}

function renderCard() {
  return render(
    <SortableBoardCard cardId={7} titulo="Um card">
      {({ dragProps }) => <div {...dragProps} data-testid="card">Um card</div>}
    </SortableBoardCard>
  );
}

afterEach(() => { cleanup(); sortableState.isDragging = false; });

describe('SortableBoardColumn — pickup feedback', () => {
  it('draws no drag ring while idle', () => {
    renderColumn();

    const wrapper = screen.getByTestId('column-body').parentElement;
    expect(wrapper.style.outline).toBe('');
    expect(wrapper.style.opacity).toBe('');
  });

  it('rings the whole column the moment the drag arms', () => {
    sortableState.isDragging = true;
    renderColumn();

    const wrapper = screen.getByTestId('column-body').parentElement;
    // 2px, not 1px: at the instant of activation the finger is still sitting
    // on the header, so the ring around the column is the only feedback it
    // does not cover. A hairline there was what made the whole interaction
    // read as "nothing happened".
    expect(wrapper.style.outline).toBe('2px dashed var(--v2-accent)');
    // Clear of the column's own 1px border, so the two do not merge into one
    // thick line that reads as a rendering glitch.
    expect(wrapper.style.outlineOffset).toBe('2px');
    // Still the placeholder: faded, and left IN FLOW so the row does not
    // collapse by 300px mid-gesture.
    expect(wrapper.style.opacity).toBe('0.4');
    expect(wrapper.style.height).toBe('100%');
  });
});

describe('SortableBoardCard — pickup feedback', () => {
  it('draws no drag ring while idle', () => {
    renderCard();

    const card = screen.getByTestId('card');
    expect(card.style.outline).toBe('');
    expect(card.style.opacity).toBe('');
    // The touch package is unconditional, though — it has to be in place
    // BEFORE the gesture starts or the browser claims it as a scroll.
    expect(card.style.touchAction).toBe('none');
  });

  it('rings the card the moment the drag arms, matching the column', () => {
    sortableState.isDragging = true;
    renderCard();

    const card = screen.getByTestId('card');
    expect(card.style.outline).toBe('2px dashed var(--v2-accent)');
    expect(card.style.outlineOffset).toBe('2px');
    expect(card.style.opacity).toBe('0.4');
    // And the cursor flips, which is the desktop half of the same signal.
    expect(card.style.cursor).toBe('grabbing');
  });
});
