// frontend/src/layouts/v2/BottomSheet.test.jsx
// QA (feature Clientes na sidebar v2, Bloco C): cobre o primitivo genérico
// BottomSheet.jsx isoladamente — os 3 gestos de fechar documentados no
// cabeçalho do componente (scrim, ESC, handle), a garantia de que clique
// DENTRO do painel NÃO fecha (regressão fácil de reintroduzir bastaria
// remover o stopPropagation), e o cuidado de não deixar um listener de
// `keydown` "vazando" quando o sheet está fechado.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { BottomSheet } from './BottomSheet.jsx';

afterEach(() => cleanup());

describe('BottomSheet — visibilidade', () => {
  it('não renderiza nada (nem o scrim) quando open=false', () => {
    render(
      <BottomSheet open={false} onClose={vi.fn()}>
        <div>conteúdo</div>
      </BottomSheet>
    );
    expect(screen.queryByTestId('bottom-sheet-scrim')).toBeNull();
    expect(screen.queryByText('conteúdo')).toBeNull();
  });

  it('renderiza o scrim, o painel e os children quando open=true', () => {
    render(
      <BottomSheet open onClose={vi.fn()}>
        <div>conteúdo</div>
      </BottomSheet>
    );
    expect(screen.getByTestId('bottom-sheet-scrim')).not.toBeNull();
    expect(screen.getByTestId('bottom-sheet-panel')).not.toBeNull();
    expect(screen.getByText('conteúdo')).not.toBeNull();
  });
});

describe('BottomSheet — 3 gestos de fechar', () => {
  it('clicar no scrim chama onClose', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose}>
        <div>conteúdo</div>
      </BottomSheet>
    );
    fireEvent.click(screen.getByTestId('bottom-sheet-scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tecla ESC chama onClose', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose}>
        <div>conteúdo</div>
      </BottomSheet>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('outras teclas não chamam onClose', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose}>
        <div>conteúdo</div>
      </BottomSheet>
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicar no handle chama onClose', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose}>
        <div>conteúdo</div>
      </BottomSheet>
    );
    fireEvent.click(screen.getByTestId('bottom-sheet-handle'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('BottomSheet — clique interno NÃO fecha (regressão)', () => {
  it('clicar em conteúdo dentro do painel não chama onClose', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose}>
        <button type="button">Ação interna</button>
      </BottomSheet>
    );
    fireEvent.click(screen.getByText('Ação interna'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicar em qualquer ponto vazio do painel (fora dos children) também não fecha', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose}>
        <div>conteúdo</div>
      </BottomSheet>
    );
    fireEvent.click(screen.getByTestId('bottom-sheet-panel'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('BottomSheet — listener de ESC não vaza quando fechado', () => {
  it('ESC não faz nada quando o sheet já está fechado', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open={false} onClose={onClose}>
        <div>conteúdo</div>
      </BottomSheet>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('remove o listener ao fechar: ESC após open->closed não chama mais onClose', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <BottomSheet open onClose={onClose}>
        <div>conteúdo</div>
      </BottomSheet>
    );
    rerender(
      <BottomSheet open={false} onClose={onClose}>
        <div>conteúdo</div>
      </BottomSheet>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

// Navegação mobile dedicada do Layout v2 (plano do TL, Tarefa 5): 3 props
// aditivas novas (maxHeightVh, fixedFooter, escapeEnabled) — cobre só o
// comportamento NOVO; os describes acima (sem essas props) já garantem que
// os defaults preservam 100% o comportamento anterior.
describe('BottomSheet — maxHeightVh (prop aditiva)', () => {
  it('sem a prop, usa 85vh (default, comportamento anterior)', () => {
    render(
      <BottomSheet open onClose={vi.fn()}>
        <div>conteúdo</div>
      </BottomSheet>
    );
    expect(screen.getByTestId('bottom-sheet-panel').style.maxHeight).toBe('85vh');
  });

  it('com a prop, usa o valor passado', () => {
    render(
      <BottomSheet open onClose={vi.fn()} maxHeightVh={68}>
        <div>conteúdo</div>
      </BottomSheet>
    );
    expect(screen.getByTestId('bottom-sheet-panel').style.maxHeight).toBe('68vh');
  });
});

describe('BottomSheet — fixedFooter (prop aditiva)', () => {
  it('sem a prop (default false), o painel continua overflowY:auto', () => {
    render(
      <BottomSheet open onClose={vi.fn()}>
        <div>conteúdo</div>
      </BottomSheet>
    );
    expect(screen.getByTestId('bottom-sheet-panel').style.overflowY).toBe('auto');
  });

  it('com fixedFooter=true, o painel vira overflow:hidden (quem usa monta a própria área rolável)', () => {
    render(
      <BottomSheet open onClose={vi.fn()} fixedFooter>
        <div>conteúdo</div>
      </BottomSheet>
    );
    const panel = screen.getByTestId('bottom-sheet-panel');
    expect(panel.style.overflow).toBe('hidden');
  });
});

describe('BottomSheet — escapeEnabled (prop aditiva)', () => {
  it('sem a prop (default true), ESC continua fechando (comportamento anterior)', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose}>
        <div>conteúdo</div>
      </BottomSheet>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('com escapeEnabled=false, ESC não chama onClose (listener nem é registrado)', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} escapeEnabled={false}>
        <div>conteúdo</div>
      </BottomSheet>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('escapeEnabled volta a true (rerender): ESC volta a fechar', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <BottomSheet open onClose={onClose} escapeEnabled={false}>
        <div>conteúdo</div>
      </BottomSheet>
    );
    rerender(
      <BottomSheet open onClose={onClose} escapeEnabled>
        <div>conteúdo</div>
      </BottomSheet>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
