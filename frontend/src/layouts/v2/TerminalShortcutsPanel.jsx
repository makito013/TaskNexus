// frontend/src/layouts/v2/TerminalShortcutsPanel.jsx
// Grade 4x2 de atalhos do terminal no layout v2: dá Esc, Shift+Tab, Enter e
// Alt+Enter (nova linha) a dispositivos cujo teclado virtual não tem tecla
// física pra eles, mais o mesmo conjunto Ctrl+C/Tab/setas já provado em
// components/IpadToolbar.jsx (v1). Bytes vão direto pro WebSocket do PTY via
// sendControlByte do TerminalPanel (frontend/src/components/TerminalPanel.jsx),
// contornando por completo o tratamento de teclado do xterm.js — mesmo
// mecanismo do v1.
//
// Fase 1 do FAB: este arquivo era `TerminalShortcutsBar.jsx`, uma faixa fixa em
// fluxo dentro do ChatV2 que comia ~56px de altura do terminal permanentemente.
// Agora é um overlay `position: fixed` montado/desmontado por
// TerminalShortcutsFab.jsx, que também assumiu o hard gate de
// useIsTouchDevice — este componente NÃO tem mais gate próprio e nunca deve
// ser renderizado sem o FAB decidindo por ele. `left`/`top`/`transformOrigin`
// vêm calculados de fora (utils/fabGeometry.js getPanelPlacement); este
// componente não faz conta nenhuma de posição.
//
// O que morreu com a barra: `overflowX: auto` + `touchAction: 'pan-x'` +
// `WebkitOverflowScrolling` (a grade 4x2 cabe inteira, não rola mais),
// `borderBottom` e `flexShrink` (não está mais em fluxo).
import { useRef } from 'react';
import {
  PANEL_CELL_GAP_PX,
  PANEL_COLUMNS,
  PANEL_PADDING_PX,
} from '../../utils/fabGeometry.js';

// A justificativa do drag-scroll horizontal morreu junto com o `overflowX`,
// mas o slop de tap-vs-move do ShortcutButton CONTINUA necessário por outro
// motivo, mais forte: um toque que começa num botão e escorrega faz parte de um
// gesto que não era um tap (dedo tremendo, ou o início de um arrasto do FAB que
// passou por cima da grade), e mandar um `^C` pro PTY por acidente é
// destrutivo e irreversível. Cada botão também precisa de preventDefault() no
// seu próprio up-event pra não tirar o foco do DOM do textarea oculto do
// terminal no meio da sessão (mesmo requisito de components/IpadToolbar.jsx).
// Disparar esse preventDefault() incondicionalmente no pointerdown — como o
// IpadToolbar.jsx faz — impediria o browser de reconhecer qualquer gesto que
// COMECE num botão, então a decisão fica pro pointerup: só dispara o payload se
// o ponteiro ficou dentro de TAP_SLOP_PX de onde desceu.
const TAP_SLOP_PX = 10;

const CONTROLS = [
  { label: 'Esc',  ariaLabel: 'Esc',                   payload: new Uint8Array([0x1b]) },
  { label: '⇧Tab', ariaLabel: 'Shift+Tab',              payload: '\x1b[Z' },
  { label: 'Tab',  ariaLabel: 'Tab',                    payload: '\t' },
  { label: '↑',    ariaLabel: 'Seta para cima',         payload: '\x1b[A' },
  { label: '↓',    ariaLabel: 'Seta para baixo',        payload: '\x1b[B' },
  { label: '↵',    ariaLabel: 'Enter',                  payload: '\r' },
  { label: '⌥↵',   ariaLabel: 'Nova linha (Alt+Enter)', payload: '\x1b\r' },
  { label: '^C',   ariaLabel: 'Ctrl+C',                 payload: new Uint8Array([0x03]) },
];

const btnStyle = {
  width: 'var(--touch-target, 44px)',
  height: 'var(--touch-target, 44px)',
  borderRadius: 'var(--radius-sm, 8px)',
  border: '1px solid var(--v2-border)',
  background: 'var(--v2-surface-3)',
  color: 'var(--v2-text)',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  touchAction: 'manipulation',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  flexShrink: 0,
};

/**
 * ShortcutButton — um botão da grade. Guarda a posição de descida do ponteiro
 * num ref (não em estado — um arrasto dispara muitos pointermove por frame e
 * nada disso precisa de re-render) e só trata o gesto como tap, disparando
 * preventDefault() + o payload, se o ponteiro nunca passou de TAP_SLOP_PX antes
 * de subir. Um arrasto que começa no botão é deixado em paz: nenhum
 * preventDefault() em ponto nenhum.
 */
function ShortcutButton({ label, ariaLabel, payload, terminalRef }) {
  const downPosRef = useRef(null);

  const handlePointerDown = (e) => {
    downPosRef.current = { x: e.clientX, y: e.clientY, dragging: false };
  };

  const handlePointerMove = (e) => {
    const down = downPosRef.current;
    if (!down || down.dragging) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) {
      down.dragging = true;
    }
  };

  const handlePointerUp = (e) => {
    const down = downPosRef.current;
    downPosRef.current = null;
    if (!down || down.dragging) return; // não foi um tap — não dispara nada
    e.preventDefault();
    terminalRef?.current?.sendControlByte(payload);
  };

  const handlePointerCancel = () => {
    downPosRef.current = null;
  };

  return (
    <button
      aria-label={ariaLabel}
      title={ariaLabel}
      style={btnStyle}
      // Mesmo fix D-10 do IpadToolbar.jsx: não roubar o foco do terminal no
      // tap, e sair do handler de blur-ao-tocar-fora do TerminalPanel via
      // data-terminal-safe-tap, pra que o usuário continue digitando logo
      // depois de tocar num atalho.
      data-terminal-safe-tap="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {label}
    </button>
  );
}

const gridStyle = (left, top, transformOrigin) => ({
  position: 'fixed',
  left: `${left}px`,
  top: `${top}px`,
  // 31 = zIndex do FAB (30) + 1: pinta SOBRE a sombra do FAB, não sob ela.
  // Continua abaixo de todo sheet/overlay mobile (40+), que é o certo: com o
  // MobileChatSheet ou o MobileMenuScreen abertos o painel não deve flutuar por
  // cima. Ver o racional completo em TerminalShortcutsFab.jsx.
  zIndex: 31,
  display: 'grid',
  // Contagem de colunas, gap e padding vêm de utils/fabGeometry.js: são
  // exatamente os três números que PANEL_WIDTH_PX/PANEL_HEIGHT_PX usam para
  // ESTIMAR o retângulo do painel na colocação. Duplicá-los como literais aqui
  // (como era antes) é a origem da deriva: mudar o gap para 6px acertaria o
  // layout e deixaria a estimativa de colocação errada por 6px, sem sintoma
  // nenhum além de um painel um pouco fora de lugar perto da borda.
  //
  // A CÉLULA continua em `var(--touch-target, 44px)` de propósito, e não em
  // PANEL_CELL_PX: é o mesmo token que os botões usam (btnStyle acima), então
  // coluna e botão nunca podem divergir entre si. Trocar por um px de JS faria o
  // painel deixar de acompanhar o token, e a divergência só apareceria no
  // dispositivo real (o Vitest roda com `css: false`, nenhuma regra .css existe
  // nos testes).
  gridTemplateColumns: `repeat(${PANEL_COLUMNS}, var(--touch-target, 44px))`,
  gap: `${PANEL_CELL_GAP_PX}px`,
  padding: `${PANEL_PADDING_PX}px`,
  // --v2-surface-2 preserva exatamente o contraste já validado nos dois temas
  // pela barra antiga: botões em --v2-surface-3 sobre um fundo --v2-surface-2.
  background: 'var(--v2-surface-2)',
  border: '1px solid var(--v2-border)',
  borderRadius: 'var(--radius-md, 12px)',
  boxShadow: 'var(--v2-shadow-lg)',
  transformOrigin,
  touchAction: 'manipulation',
});

/**
 * TerminalShortcutsPanel — a grade em si. Sem gate de dispositivo: quem decide
 * se ela existe é TerminalShortcutsFab.jsx.
 *
 * `terminalRef` (renomeado de `panelRef`: um componente chamado
 * TerminalShortcutsPanel recebendo uma prop `panelRef` que aponta pra um OUTRO
 * painel — o TerminalPanel — é armadilha de leitura) deve ser um ref pra uma
 * instância de TerminalPanel expondo `sendControlByte(payload)` via
 * useImperativeHandle.
 */
export function TerminalShortcutsPanel({ terminalRef, id, left, top, transformOrigin }) {
  return (
    <div
      id={id}
      role="group"
      aria-label="Terminal shortcuts"
      className="v2-fab-panel-enter"
      style={gridStyle(left, top, transformOrigin)}
      // Os botões já têm o atributo, e TerminalPanel.jsx:493 usa
      // `closest('[data-terminal-safe-tap]')`, então o ancestral por si só
      // cobriria os descendentes. Ele existe AQUI porque os gaps de 4px entre
      // células e os 8px de padding do container são zona morta tocável real:
      // um toque ali, sem o atributo, daria blur() no textarea do xterm e
      // FECHARIA o teclado do iPad no meio da digitação.
      data-terminal-safe-tap="true"
    >
      {CONTROLS.map(({ label, ariaLabel, payload }) => (
        <ShortcutButton
          key={ariaLabel}
          label={label}
          ariaLabel={ariaLabel}
          payload={payload}
          terminalRef={terminalRef}
        />
      ))}
    </div>
  );
}
