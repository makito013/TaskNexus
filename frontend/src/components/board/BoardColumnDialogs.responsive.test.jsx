// frontend/src/components/board/BoardColumnDialogs.responsive.test.jsx
// The two column dialogs present differently by viewport (Bruno's call after
// testing phase 2 live): bottom sheet on a phone, real centred modal on
// desktop with the actions SIDE BY SIDE instead of stacked.
//
// A dedicated file because it needs `window.matchMedia` driven per test, and
// the other suites deliberately run with none at all (which is what makes them
// exercise the desktop branch). Here both branches are exercised on purpose.
//
// The container primitives themselves (BottomSheet / CenteredModal) have their
// own tests — this file only asserts that the right one is chosen and that
// nothing which already worked was lost in the move.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { BoardColumnRenameDialog } from './BoardColumnRenameDialog.jsx';
import { BoardColumnDeleteDialog } from './BoardColumnDeleteDialog.jsx';

// `useMediaQuery` reads `matchMedia(query).matches` on first render, so the
// stub has to answer for the exact query the component asks about
// (MOBILE_VIEWPORT_QUERY, '(max-width: 640px)').
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

const onModal = () => setViewport(false);
const onPhone = () => setViewport(true);

beforeEach(() => { onModal(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderRename(props = {}) {
  return render(
    <BoardColumnRenameDialog
      open
      columnLabel="A Fazer"
      onConfirm={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  );
}

function renderDelete(props = {}) {
  return render(
    <BoardColumnDeleteDialog
      open
      columnLabel="A Fazer"
      reason="confirm"
      onConfirm={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  );
}

describe('column dialogs — which container each viewport gets', () => {
  it('renders the rename dialog as a centred modal on desktop', () => {
    renderRename();

    expect(screen.getByTestId('centered-modal-panel')).toBeTruthy();
    expect(screen.queryByTestId('bottom-sheet-panel')).toBeNull();
  });

  it('renders the rename dialog as a bottom sheet on a phone', () => {
    onPhone();
    renderRename();

    expect(screen.getByTestId('bottom-sheet-panel')).toBeTruthy();
    expect(screen.queryByTestId('centered-modal-panel')).toBeNull();
  });

  it('renders the delete dialog as a centred modal on desktop', () => {
    renderDelete();

    expect(screen.getByTestId('centered-modal-panel')).toBeTruthy();
    expect(screen.queryByTestId('bottom-sheet-panel')).toBeNull();
  });

  it('renders the delete dialog as a bottom sheet on a phone', () => {
    onPhone();
    renderDelete();

    expect(screen.getByTestId('bottom-sheet-panel')).toBeTruthy();
    expect(screen.queryByTestId('centered-modal-panel')).toBeNull();
  });
});

describe('column dialogs — actions side by side in modal mode', () => {
  it('puts Cancelar and Confirmar in one flex row, confirm last', () => {
    renderRename();

    const confirm = screen.getByText('Confirmar');
    const cancel = screen.getByText('Cancelar');
    const footer = confirm.parentElement;

    // Same parent = one row, not two stacked full-width bars.
    expect(cancel.parentElement).toBe(footer);
    expect(footer.style.display).toBe('flex');
    expect(footer.style.justifyContent).toBe('flex-end');
    // Neither button stretches across the sheet any more.
    expect(confirm.style.width).not.toBe('100%');
    expect(cancel.style.width).not.toBe('100%');
    // Confirm is the last child — the desktop convention.
    expect(footer.lastElementChild).toBe(confirm);
  });

  it('puts Cancelar and "Excluir coluna" in one flex row, destructive last', () => {
    renderDelete();

    const destructive = screen.getByText('Excluir coluna');
    const cancel = screen.getByText('Cancelar');
    const footer = destructive.parentElement;

    expect(cancel.parentElement).toBe(footer);
    expect(footer.style.display).toBe('flex');
    expect(footer.lastElementChild).toBe(destructive);
    // Danger still reads as danger in the new shape.
    expect(destructive.style.color).toBe('var(--v2-danger)');
  });

  it('keeps the actions stacked full-width on a phone', () => {
    onPhone();
    renderRename();

    const confirm = screen.getByText('Confirmar');
    const cancel = screen.getByText('Cancelar');
    expect(confirm.style.width).toBe('100%');
    expect(cancel.style.width).toBe('100%');
  });
});

describe('column dialogs — dialog semantics are not duplicated', () => {
  // CenteredModal already renders role="dialog" + aria-modal + the name.
  // Adding our own would put TWO dialogs in the tree for one dialog.
  it('exposes exactly one dialog, correctly named, in modal mode', () => {
    renderRename();

    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].getAttribute('aria-label')).toBe('Renomear coluna — A Fazer');
    expect(dialogs[0].getAttribute('aria-modal')).toBe('true');
  });

  // BottomSheet carries no dialog semantics at all, so in sheet mode the
  // component has to supply them — the exact opposite of the branch above.
  it('exposes exactly one dialog, correctly named, in sheet mode', () => {
    onPhone();
    renderRename();

    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].getAttribute('aria-label')).toBe('Renomear coluna — A Fazer');
  });

  it('names the delete dialog in both modes', () => {
    renderDelete();
    expect(screen.getByRole('dialog').getAttribute('aria-label'))
      .toBe('Excluir coluna — A Fazer');

    cleanup();
    onPhone();
    renderDelete();
    expect(screen.getByRole('dialog').getAttribute('aria-label'))
      .toBe('Excluir coluna — A Fazer');
  });
});

// Everything below already worked in sheet mode. These pin that the move to a
// centred modal did not quietly drop any of it.
describe('column dialogs — behaviour preserved in modal mode', () => {
  it('prefills the input and selects the text, ready to be replaced', () => {
    renderRename();

    const input = screen.getByLabelText('Novo nome da coluna');
    expect(input.value).toBe('A Fazer');
    // CenteredModal focuses `initialFocusRef` on open; without it the panel
    // would steal focus and drop this selection.
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('A Fazer'.length);
  });

  it('confirms on Enter', () => {
    const onConfirm = vi.fn();
    renderRename({ onConfirm });

    const input = screen.getByLabelText('Novo nome da coluna');
    fireEvent.change(input, { target: { value: 'Backlog' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onConfirm).toHaveBeenCalledWith('Backlog');
  });

  it('closes on Escape — now handled by the container, not by this component', () => {
    const onClose = vi.fn();
    renderRename({ onClose });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('does not close on Escape while saving', () => {
    const onClose = vi.fn();
    renderRename({ onClose, saving: true });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the duplicate-name error inline and keeps the dialog open', () => {
    renderRename({ error: "Já existe uma coluna chamada 'Feito'" });

    expect(screen.getByRole('alert').textContent).toMatch(/Já existe/);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('disables Confirmar for a blank name', () => {
    renderRename();

    fireEvent.change(screen.getByLabelText('Novo nome da coluna'), {
      target: { value: '   ' },
    });

    expect(screen.getByText('Confirmar').disabled).toBe(true);
  });

  it('keeps the three delete refusals: done column offers only "Entendi"', () => {
    renderDelete({ reason: 'coluna_concluida' });

    expect(screen.getByText('Entendi')).toBeTruthy();
    expect(screen.queryByText('Excluir coluna')).toBeNull();
    expect(screen.queryByText('Cancelar')).toBeNull();
  });

  it('keeps the three delete refusals: card count, no destructive button', () => {
    renderDelete({ reason: 'coluna_com_cards', cards: 3 });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/3 card\(s\)/)).toBeTruthy();
    expect(within(dialog).queryByText('Excluir coluna')).toBeNull();
    expect(within(dialog).getByText('Cancelar')).toBeTruthy();
  });

  it('keeps the fail-safe: an unknown reason gets no destructive button', () => {
    renderDelete({ reason: 'motivo_desconhecido' });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Não foi possível excluir a coluna/)).toBeTruthy();
    expect(within(dialog).queryByText('Excluir coluna')).toBeNull();
  });

  it('shows the in-flight label while deleting', () => {
    renderDelete({ deleting: true });

    expect(screen.getByText('Excluindo…')).toBeTruthy();
    expect(screen.getByText('Excluindo…').disabled).toBe(true);
  });
});
