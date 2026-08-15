// frontend/src/layouts/v2/TerminalShortcutsPanel.jsx
// Grade de atalhos do terminal no layout v2: dá Esc, Shift+Tab, Enter e
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
// `WebkitOverflowScrolling` (a grade cabe inteira, não rola mais),
// `borderBottom` e `flexShrink` (não está mais em fluxo).
//
// Rodada 2 (Frente C): o painel deixou de ser 4x2 e passou a ter uma primeira
// linha de controles, exatamente o desenho do Bruno:
//
//   [ ☐ Esconder teclado          ][⧉]
//   [ Esc ][ ⇧Tab ][ Tab ][  ↑   ]
//   [  ↓  ][  ↵   ][ ⌥↵  ][  ^C  ]
//
// O toggle e o botão de colar são a MESMA linha do grid (3 colunas + 1), então a
// largura do painel não muda e a altura sobe exatamente uma célula — é o que
// PANEL_ROW_HEIGHTS_PX (utils/fabGeometry.js) já estima.
import { useRef } from 'react';
import { useKeyboardSuppressed } from '../../hooks/useKeyboardSuppressed.js';
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
 * useTapGesture — a disciplina de gesto que TODO botão deste painel precisa,
 * num lugar só.
 *
 * Guarda a posição de descida do ponteiro num ref (não em estado — um arrasto
 * dispara muitos pointermove por frame e nada disso precisa de re-render) e só
 * trata o gesto como tap, disparando preventDefault() + `onTap()`, se o ponteiro
 * nunca passou de TAP_SLOP_PX antes de subir. Um arrasto que começa no botão é
 * deixado em paz: nenhum preventDefault() em ponto nenhum.
 *
 * Extraído de dentro do ShortcutButton na Rodada 2 porque o painel passou a ter
 * TRÊS tipos de botão (atalho, toggle de teclado, colar) e os três precisam da
 * mesma disciplina. Duplicar isto três vezes é exatamente como o `^C`
 * acidental volta: basta uma cópia esquecer o slop.
 *
 * `onTap` é lido no momento do pointerup a partir do closure do render atual,
 * então não precisa ser estável entre renders.
 */
function useTapGesture(onTap) {
  const downPosRef = useRef(null);

  const onPointerDown = (e) => {
    downPosRef.current = { x: e.clientX, y: e.clientY, dragging: false };
  };

  const onPointerMove = (e) => {
    const down = downPosRef.current;
    if (!down || down.dragging) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) {
      down.dragging = true;
    }
  };

  const onPointerUp = (e) => {
    const down = downPosRef.current;
    downPosRef.current = null;
    if (!down || down.dragging) return; // não foi um tap — não dispara nada
    e.preventDefault();
    onTap();
  };

  const onPointerCancel = () => {
    downPosRef.current = null;
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}

/**
 * ShortcutButton — um botão da grade. Toda a máquina de tap-vs-arrasto vem do
 * useTapGesture acima; a API externa deste componente não mudou na extração.
 */
function ShortcutButton({ label, ariaLabel, payload, terminalRef }) {
  const tapHandlers = useTapGesture(() => terminalRef?.current?.sendControlByte(payload));

  return (
    <button
      // `type="button"` explícito, como nos outros três botões deste arquivo e
      // no FAB: o default do HTML é `type="submit"`, e um <button> sem type
      // dentro de um <form> ancestral submeteria o formulário além de mandar o
      // control byte. Não há <form> na cadeia do painel hoje — é justamente por
      // isso que a omissão era invisível, e é o tipo de regressão que só
      // aparece quando alguém envolver a árvore num <form> muito depois.
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      style={btnStyle}
      // Mesmo fix D-10 do IpadToolbar.jsx: não roubar o foco do terminal no
      // tap, e sair do handler de blur-ao-tocar-fora do TerminalPanel via
      // data-terminal-safe-tap, pra que o usuário continue digitando logo
      // depois de tocar num atalho.
      data-terminal-safe-tap="true"
      {...tapHandlers}
    >
      {label}
    </button>
  );
}

// A barra larga da primeira linha. `gridColumn: '1 / 4'` = 3 das 4 colunas; a
// quarta é do botão de colar. Não tem `width` própria de propósito: quem decide
// a largura é o grid (3 colunas + os 2 gaps entre elas), então a barra acompanha
// o token --touch-target junto com as células sem uma segunda fonte da verdade.
// `flexShrink` do btnStyle não se aplica aqui (item de grid, não de flex), mas
// `width` fixa se aplicaria — por isso o override explícito para 'auto'.
const toggleStyle = (suppressed) => ({
  ...btnStyle,
  gridColumn: '1 / 4',
  width: 'auto',
  // `border` inteiro reescrito, e não só `borderColor` por cima do shorthand do
  // btnStyle: o `cssstyle` do jsdom trata shorthand + longhand na mesma ordem de
  // chaves do objeto, e depender dessa ordem é o tipo de coisa que passa no
  // teste e fica inerte no dispositivo (ou o contrário).
  border: `1px solid ${suppressed ? 'var(--v2-accent)' : 'var(--v2-border)'}`,
  // 11px porque o rótulo é uma frase, não um glifo de 3 caracteres como nos
  // atalhos; em 12px "☑ Esconder teclado" não cabe nas 3 colunas do iPhone.
  fontSize: '11px',
  gap: '4px',
  padding: '0 4px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
});

const pasteButtonStyle = {
  ...btnStyle,
  gridColumn: '4 / 5',
  // Glifo maior que os 12px dos atalhos: `⧉` é desenho, não texto, e em 12px
  // fica ilegível ao lado de rótulos como `⇧Tab`.
  fontSize: '16px',
};

/**
 * KeyboardSuppressionToggle — o "esconder teclado".
 *
 * Rótulo ESTÁVEL + `aria-pressed`, decisão travada: um texto que alternasse
 * entre "esconder"/"mostrar" torna o botão ambíguo (o texto é o estado atual ou
 * a ação?) e é a origem clássica de toggle que o usuário aciona ao contrário.
 * Quem carrega o estado é `aria-pressed` (para AT) e o glifo ☑/☐ (para os
 * olhos) — o glifo, e não só a cor da borda, porque cor sozinha não sobrevive
 * aos dois temas sem uma passada do Designer, e não há Designer nesta rodada.
 *
 * O estado NÃO é prop: vem do useKeyboardSuppressed, o mesmo hook que o
 * TerminalPanel consome. Ver o cabeçalho daquele arquivo.
 */
function KeyboardSuppressionToggle() {
  const [suppressed, toggle] = useKeyboardSuppressed();
  const tapHandlers = useTapGesture(toggle);
  const label = 'Esconder teclado';

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={suppressed}
      title={label}
      style={toggleStyle(suppressed)}
      // Sem isto, tocar no toggle cairia no onOutsideTap do TerminalPanel e
      // daria blur() no textarea do xterm. O container do painel já tem o
      // atributo e `closest()` o alcançaria, mas mantê-lo aqui é coerente com os
      // 8 atalhos e sobrevive a uma remoção do atributo do container.
      data-terminal-safe-tap="true"
      {...tapHandlers}
    >
      <span aria-hidden="true">{suppressed ? '☑' : '☐'}</span>
      {label}
    </button>
  );
}

/**
 * PasteButton — cola o conteúdo da área de transferência no PTY.
 *
 * Existe por um resíduo específico: com a textarea do xterm em `readOnly`, NÃO
 * está documentado (nem é normativo) se o menu de callout do iOS continua
 * oferecendo "Colar". O evento `paste` dispara em alvo não editável e o xterm lê
 * do evento em vez de esperar o UA inserir texto, então o gesto nativo deve
 * sobreviver — mas se o menu não oferecer o item, o evento nunca nasce. Este
 * botão cobre exatamente esse resíduo, contornando a textarea inteira, e por
 * isso funciona com o modo "esconder teclado" ligado sem destravar nada.
 */
function PasteButton({ terminalRef }) {
  // Guard duplo, e nenhum é cosmético: `navigator.clipboard` só existe em
  // contexto seguro (o deploy.ps1 do Bruno serve https com cert Tailscale, mas o
  // serviço NSSM e o deploy.sh servem http://localhost) e `readText` pode faltar
  // mesmo onde `clipboard` existe. Sem contexto seguro o botão NASCE
  // desabilitado, com o title explicando, em vez de estourar no toque.
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;

  const tapHandlers = useTapGesture(() => {
    if (!canPaste) return;
    // readText() TEM que ser chamado sincronamente aqui: o WebKit exige ativação
    // transitória e qualquer `await` antes desta linha a consome, fazendo a
    // promise rejeitar de imediato. Por isso `.then()` e não `async/await`.
    navigator.clipboard.readText()
      .then((text) => {
        if (text) terminalRef?.current?.pasteText(text);
      })
      .catch(() => {
        // Silêncio DELIBERADO e enumerado: o único caminho de rejeição aqui é o
        // usuário ter negado a confirmação nativa de "Paste" do WebKit (ou a
        // área de transferência estar vazia/sem texto). Nos dois casos a
        // intenção do usuário foi "não colar" — um banner de erro seria ruído
        // sobre uma ação que funcionou como pedido.
      });
  });

  const label = 'Colar da área de transferência';

  return (
    <button
      type="button"
      aria-label={label}
      title={canPaste ? label : 'Requer uma conexão segura (https)'}
      disabled={!canPaste}
      style={pasteButtonStyle}
      data-terminal-safe-tap="true"
      {...tapHandlers}
    >
      ⧉
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
 * instância de TerminalPanel expondo `sendControlByte(payload)` e
 * `pasteText(text)` via useImperativeHandle.
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
      {/* Primeira linha, o desenho do Bruno: uma barra larga com o toggle
          ocupando 3 das 4 colunas e o botão de colar na quarta. Não há
          `gridTemplateRows`/`gridAutoRows` em lugar nenhum de propósito: cada
          célula tem `height` própria (var(--touch-target)), e uma terceira fonte
          da mesma altura só criaria divergência. A altura resultante (156px) é o
          que PANEL_ROW_HEIGHTS_PX estima em utils/fabGeometry.js. */}
      <KeyboardSuppressionToggle />
      <PasteButton terminalRef={terminalRef} />
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
