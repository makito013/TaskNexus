// frontend/src/layouts/v2/TerminalShortcutsPanel.test.jsx
// Usa um objeto simples { current: { sendControlByte: vi.fn() } } no lugar do
// ref do TerminalPanel — nenhum TerminalPanel/xterm.js real aqui.
//
// Fase 1 do FAB: o hard gate de useIsTouchDevice saiu deste componente e subiu
// pro TerminalShortcutsFab, então o mock do hook e o describe do gate saíram
// junto (o teste do gate reaparece em TerminalShortcutsFab.test.jsx). O que
// resta aqui é o contrato que este componente ainda é dono: os 8 payloads, o
// slop de tap-vs-arrasto e a null-safety do ref.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import {
  KEYBOARD_SUPPRESSED_EVENT,
  KEYBOARD_SUPPRESSED_STORAGE_KEY,
} from '../../hooks/useKeyboardSuppressed.js';
import { TerminalShortcutsPanel } from './TerminalShortcutsPanel.jsx';

afterEach(() => {
  cleanup();
});

// left/top/transformOrigin são calculados pelo FAB (utils/fabGeometry.js
// getPanelPlacement) e chegam prontos como prop; para este arquivo qualquer
// valor serve, o posicionamento não é o que está sob teste aqui.
const PLACEMENT = { left: 100, top: 200, transformOrigin: 'left top' };

const BUTTONS = [
  { ariaLabel: 'Esc', payload: new Uint8Array([0x1b]) },
  { ariaLabel: 'Shift+Tab', payload: '\x1b[Z' },
  { ariaLabel: 'Tab', payload: '\t' },
  { ariaLabel: 'Seta para cima', payload: '\x1b[A' },
  { ariaLabel: 'Seta para baixo', payload: '\x1b[B' },
  { ariaLabel: 'Enter', payload: '\r' },
  { ariaLabel: 'Nova linha (Alt+Enter)', payload: '\x1b\r' },
  { ariaLabel: 'Ctrl+C', payload: new Uint8Array([0x03]) },
];

describe('TerminalShortcutsPanel — buttons', () => {
  it('renders all 8 expected buttons', () => {
    render(<TerminalShortcutsPanel terminalRef={{ current: { sendControlByte: vi.fn() } }} {...PLACEMENT} />);
    BUTTONS.forEach(({ ariaLabel }) => {
      expect(screen.getByLabelText(ariaLabel)).toBeTruthy();
    });
  });

  it('renders every button with an explicit type="button"', () => {
    // O default do HTML para <button> é `type="submit"`. Nenhum <form> existe na
    // cadeia deste painel hoje, e é EXATAMENTE por isso que a omissão passou
    // despercebida por uma rodada inteira no ShortcutButton: o sintoma só nasce
    // quando alguém envolver a árvore num <form>, muito depois, e aí um tap no
    // `Esc` manda o control byte E submete o formulário.
    //
    // A asserção varre TODOS os <button> do painel em vez dos 8 atalhos: os
    // outros dois (o toggle de teclado e o colar) já nasceram com o atributo, e
    // uma varredura por elemento é o que faz um botão NOVO — a forma mais
    // provável de a regressão voltar — entrar no teste sem ninguém lembrar de
    // atualizá-lo.
    const { container } = render(
      <TerminalShortcutsPanel terminalRef={{ current: { sendControlByte: vi.fn() } }} {...PLACEMENT} />
    );

    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.length).toBe(BUTTONS.length + 2); // 8 atalhos + toggle + colar
    for (const button of buttons) {
      expect(button.getAttribute('type'), button.getAttribute('aria-label')).toBe('button');
    }
  });

  it.each(BUTTONS)('$ariaLabel calls sendControlByte with the right payload on a tap (down+up, no movement)', ({ ariaLabel, payload }) => {
    const sendControlByte = vi.fn();
    render(<TerminalShortcutsPanel terminalRef={{ current: { sendControlByte } }} {...PLACEMENT} />);
    const button = screen.getByLabelText(ariaLabel);
    fireEvent.pointerDown(button, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(button, { clientX: 10, clientY: 10 });
    expect(sendControlByte).toHaveBeenCalledWith(payload);
  });

  it('does not call sendControlByte when the pointer moves past the tap threshold before going up (not a tap)', () => {
    const sendControlByte = vi.fn();
    render(<TerminalShortcutsPanel terminalRef={{ current: { sendControlByte } }} {...PLACEMENT} />);
    const button = screen.getByLabelText('Esc');
    fireEvent.pointerDown(button, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(button, { clientX: 40, clientY: 10 }); // 30px, past TAP_SLOP_PX
    fireEvent.pointerUp(button, { clientX: 40, clientY: 10 });
    expect(sendControlByte).not.toHaveBeenCalled();
  });

  it('still calls sendControlByte when movement stays within the tap threshold', () => {
    const sendControlByte = vi.fn();
    render(<TerminalShortcutsPanel terminalRef={{ current: { sendControlByte } }} {...PLACEMENT} />);
    const button = screen.getByLabelText('Esc');
    fireEvent.pointerDown(button, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(button, { clientX: 14, clientY: 10 }); // 4px, within TAP_SLOP_PX
    fireEvent.pointerUp(button, { clientX: 14, clientY: 10 });
    expect(sendControlByte).toHaveBeenCalledWith(new Uint8Array([0x1b]));
  });

  it('does not throw when terminalRef.current is null', () => {
    render(<TerminalShortcutsPanel terminalRef={{ current: null }} {...PLACEMENT} />);
    const button = screen.getByLabelText('Esc');
    expect(() => {
      fireEvent.pointerDown(button, { clientX: 10, clientY: 10 });
      fireEvent.pointerUp(button, { clientX: 10, clientY: 10 });
    }).not.toThrow();
  });

  it('does not throw when terminalRef itself is not passed', () => {
    expect(() => render(<TerminalShortcutsPanel {...PLACEMENT} />)).not.toThrow();
  });
});

// Rodada 2, Frente C. `localStorage` é REAL nesta suíte (Node 26 + o guard de
// vite.config.js), então a chave é limpa no beforeEach E no afterEach: um teste
// que falhe no meio deixaria a preferência ligada para o próximo, e o próximo
// passaria ou falharia pelo motivo errado.
const TOGGLE_LABEL = 'Esconder teclado';

describe('TerminalShortcutsPanel — keyboard suppression toggle', () => {
  beforeEach(() => {
    localStorage.removeItem(KEYBOARD_SUPPRESSED_STORAGE_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(KEYBOARD_SUPPRESSED_STORAGE_KEY);
  });

  it('renders the toggle spanning the first row above the shortcut grid', () => {
    const { container } = render(
      <TerminalShortcutsPanel terminalRef={{ current: { sendControlByte: vi.fn() } }} {...PLACEMENT} />
    );

    const toggle = screen.getByLabelText(TOGGLE_LABEL);
    const paste = screen.getByLabelText('Colar da área de transferência');
    // 3 das 4 colunas para o toggle, a quarta para o botão de colar: é o desenho
    // travado pelo Bruno, e é o que mantém a primeira linha sendo UMA linha (a
    // largura do painel não muda, a altura sobe exatamente uma célula).
    expect(toggle.style.gridColumn).toBe('1 / 4');
    expect(paste.style.gridColumn).toBe('4 / 5');
    // E os dois vêm ANTES dos 8 atalhos na ordem do DOM, que é o que decide a
    // ordem de preenchimento de um grid sem `grid-template-areas`.
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons[0]).toBe(toggle);
    expect(buttons[1]).toBe(paste);
    expect(buttons).toHaveLength(10); // 1 toggle + 1 colar + 8 atalhos
  });

  it('reflects the persisted state through aria-pressed on mount', () => {
    localStorage.setItem(KEYBOARD_SUPPRESSED_STORAGE_KEY, 'true');
    render(<TerminalShortcutsPanel terminalRef={{ current: {} }} {...PLACEMENT} />);

    const toggle = screen.getByLabelText(TOGGLE_LABEL);
    // Rótulo ESTÁVEL + aria-pressed: o texto NÃO alterna entre "esconder" e
    // "mostrar" (isso torna o botão ambíguo — é o estado ou a ação?).
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.textContent).toContain(TOGGLE_LABEL);
    expect(toggle.textContent).toContain('☑'); // o glifo carrega o estado sem depender de cor
  });

  it('persists the new state and notifies other consumers when tapped', () => {
    const events = [];
    const listener = (e) => events.push(e.detail);
    window.addEventListener(KEYBOARD_SUPPRESSED_EVENT, listener);

    render(<TerminalShortcutsPanel terminalRef={{ current: {} }} {...PLACEMENT} />);
    const toggle = screen.getByLabelText(TOGGLE_LABEL);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.pointerDown(toggle, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(toggle, { clientX: 10, clientY: 10 });

    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    // `String(boolean)`, o MESMO formato de useSidebarCollapsed — não '1'/'0'.
    expect(localStorage.getItem(KEYBOARD_SUPPRESSED_STORAGE_KEY)).toBe('true');
    // O CustomEvent é o que faz o TerminalPanel (ramo distante da árvore) aplicar
    // o readOnly sem prop-drilling. Um dispatch por toque, com o valor novo.
    expect(events).toEqual([true]);

    window.removeEventListener(KEYBOARD_SUPPRESSED_EVENT, listener);
  });

  it('does not fire the toggle when the pointer slips past the tap slop', () => {
    render(<TerminalShortcutsPanel terminalRef={{ current: {} }} {...PLACEMENT} />);
    const toggle = screen.getByLabelText(TOGGLE_LABEL);

    fireEvent.pointerDown(toggle, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(toggle, { clientX: 40, clientY: 10 }); // 30px, além de TAP_SLOP_PX
    fireEvent.pointerUp(toggle, { clientX: 40, clientY: 10 });

    // Mesma disciplina dos 8 atalhos (useTapGesture): um arrasto que atravessa o
    // painel não pode acionar controle nenhum.
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem(KEYBOARD_SUPPRESSED_STORAGE_KEY)).toBeNull();
  });
});

describe('TerminalShortcutsPanel — paste button', () => {
  const PASTE_LABEL = 'Colar da área de transferência';
  let originalClipboardDescriptor;

  beforeEach(() => {
    originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  });

  afterEach(() => {
    // Restaurar o descriptor exato: em jsdom `navigator.clipboard` pode nem
    // existir (contexto não-seguro), e deixar um stub para trás faria o teste de
    // "desabilitado sem contexto seguro" passar ou falhar pela ordem de execução.
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
    } else {
      delete navigator.clipboard;
    }
  });

  const installClipboard = (readText) => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText },
      configurable: true,
    });
  };

  it('pastes the clipboard text through pasteText on the terminal ref', async () => {
    const readText = vi.fn(() => Promise.resolve('linha 1\r\nlinha 2'));
    installClipboard(readText);
    const pasteText = vi.fn();
    render(<TerminalShortcutsPanel terminalRef={{ current: { pasteText } }} {...PLACEMENT} />);

    const button = screen.getByLabelText(PASTE_LABEL);
    fireEvent.pointerDown(button, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(button, { clientX: 10, clientY: 10 });

    // SINCRONAMENTE, sem nenhum await antes: o WebKit exige ativação transitória
    // e qualquer await consumido antes de readText() faz a promise rejeitar de
    // imediato. Esta asserção antes do primeiro `await` do teste é o que prova
    // que o handler não virou `async`.
    expect(readText).toHaveBeenCalledTimes(1);

    // O texto vai por pasteText -> term.paste(), que aplica bracketed paste e
    // normaliza \r\n -> \r. O componente NÃO normaliza nada por conta própria:
    // fazer isso aqui duplicaria a responsabilidade do xterm.
    await waitFor(() => expect(pasteText).toHaveBeenCalledWith('linha 1\r\nlinha 2'));
  });

  it('is disabled when navigator.clipboard is unavailable (insecure context)', () => {
    delete navigator.clipboard;
    render(<TerminalShortcutsPanel terminalRef={{ current: { pasteText: vi.fn() } }} {...PLACEMENT} />);

    const button = screen.getByLabelText(PASTE_LABEL);
    expect(button.disabled).toBe(true);
    // Um botão cinza sem explicação é confuso: o title diz o porquê.
    expect(button.getAttribute('title')).toBe('Requer uma conexão segura (https)');
  });

  it('does not throw when readText rejects (user denied the native paste prompt)', async () => {
    const readText = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    installClipboard(readText);
    const pasteText = vi.fn();
    render(<TerminalShortcutsPanel terminalRef={{ current: { pasteText } }} {...PLACEMENT} />);

    const button = screen.getByLabelText(PASTE_LABEL);
    expect(() => {
      fireEvent.pointerDown(button, { clientX: 10, clientY: 10 });
      fireEvent.pointerUp(button, { clientX: 10, clientY: 10 });
    }).not.toThrow();

    // Deixa a rejeição resolver: sem o .catch() isto seria uma unhandled
    // rejection, que o Vitest reporta como falha do arquivo inteiro.
    await Promise.resolve();
    expect(pasteText).not.toHaveBeenCalled();
  });

  it('does not paste when the clipboard is empty', async () => {
    const readText = vi.fn(() => Promise.resolve(''));
    installClipboard(readText);
    const pasteText = vi.fn();
    render(<TerminalShortcutsPanel terminalRef={{ current: { pasteText } }} {...PLACEMENT} />);

    const button = screen.getByLabelText(PASTE_LABEL);
    fireEvent.pointerDown(button, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(button, { clientX: 10, clientY: 10 });

    await Promise.resolve();
    // String vazia não é "colar nada": é não chamar o PTY. Um pasteText('')
    // atravessaria a ponte até term.paste('') sem motivo.
    expect(pasteText).not.toHaveBeenCalled();
  });
});
