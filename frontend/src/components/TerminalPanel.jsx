import { useEffect, useMemo, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { api } from '../services/api.js';
import { resolveTerminalSkin } from './terminalSkin.js';
import { MOBILE_VIEWPORT_QUERY } from '../utils/viewport.js';
import { useKeyboardSuppressed } from '../hooks/useKeyboardSuppressed.js';
import { useViewerActions } from '../features/viewer/ViewerContext.jsx';
import { sessionScope } from '../features/viewer/viewerApi.js';
import { createFilePathLinkProvider, openWebLink } from '../features/viewer/terminalLinks.js';
import { useTerminalSurface } from '../terminal/useTerminalSurface.js';
import { ansiPaletteFrom } from '../terminal/xtermDefaults.js';

// The tests (and any other V2 consumer) import isControlFrame from here.
export { isControlFrame } from '../terminal/controlFrames.js';

// Reads the --v2-* tokens from the document root, falling back to fixed colors
// when they are absent (see ansiPaletteFrom for the mapping and its history).
function resolveTerminalTheme() {
  const style = getComputedStyle(document.documentElement);
  return ansiPaletteFrom((token, fallback) => style.getPropertyValue(token).trim() || fallback);
}

export const TerminalPanel = forwardRef(function TerminalPanel({ sessionKey, projectId, agentId, visible }, ref) {
  // Repaginação estética (PLAN-terminal-skin.md, T2): a geometria da moldura
  // (root, frame, viewport) vem de uma função pura. Paleta, fonte e faixas
  // ainda não: saem de resolveTerminalTheme() e dos estilos inline abaixo. A função é
  // resolvida UMA VEZ no mount. `useMemo(..., [])` e não `useState`/efeito
  // porque nada disto é reativo: troca de tema é full-reload
  // (AppearanceSwitch.jsx chama window.location.reload() depois do PUT), e o
  // boot seta `dataset.theme` antes do primeiro render.
  // Consequência aceita e documentada: `narrow` também é mount-once, ou seja o
  // fontSize NÃO reage a uma rotação do iPad — consistente com o tema, que já
  // se comporta assim. Não é bug, não abrir ticket.
  //
  // A guarda de `typeof window.matchMedia` NÃO é redundante: o jsdom deste
  // repo não implementa matchMedia (mesmo motivo documentado em
  // hooks/useIsTouchDevice.js), e sem ela todo teste que monta o TerminalPanel
  // isolado quebraria com TypeError. 640px é MOBILE_VIEWPORT_QUERY, o mesmo
  // gate que decide se o botão flutuante "☰ Menu" existe — usar outro valor
  // abriria uma faixa de larguras com o botão presente e a compensação ausente.
  const skin = useMemo(() => resolveTerminalSkin(
    document.documentElement.dataset.theme,
    {
      narrow: typeof window.matchMedia === 'function'
        && window.matchMedia(MOBILE_VIEWPORT_QUERY).matches,
    },
  ), []);

  // Não existe mais um `wrapperRef`: ele só era lido para escrever altura no nó
  // da moldura quando o teclado abria, e essa responsabilidade migrou inteira
  // para hooks/useVisibleViewportShell.js (ver a seção 5e em terminal/useTerminalSurface.js). Um
  // ref pendurado num nó que ninguém lê é convite para alguém "reaproveitar" e
  // reintroduzir um segundo dono da altura.
  const containerRef = useRef(null);
  // Bug 2 fix: dedicated state, deliberately NOT folded into connectionStatus
  // (connecting/open/reconnecting/evicted) — resume_failed is orthogonal to
  // socket connectivity: the WS stays OPEN, just without a PTY behind it.
  const [resumeFailed, setResumeFailed] = useState(false);
  // Bug 2 QA follow-up: surfaces a failure of the "Iniciar nova conversa"
  // retry (POST /reset) itself — e.g. backend unreachable / flaky iPad
  // network. Without this the user is stuck on the overlay with no feedback
  // and no indication that clicking the same button again might work.
  const [resetError, setResetError] = useState(false);
  // .planning/debug/claude-work-ws-reconnect-loop.md: the agent's cmd could
  // not be spawned at all (e.g. it names a shell alias/function, not a real
  // executable on PATH) — holds the backend's `detail` string so the user
  // gets an actionable message instead of a silent reconnect loop.
  const [spawnFailedDetail, setSpawnFailedDetail] = useState(null);

  // Rodada 2, Frente C: modo "esconder teclado". O estado mora em
  // hooks/useKeyboardSuppressed.js (localStorage + CustomEvent) porque quem o
  // ALTERNA é o toggle dentro de layouts/v2/TerminalShortcutsPanel.jsx, dois
  // níveis abaixo de um componente irmão deste — ver o cabeçalho do hook.
  const [keyboardSuppressed] = useKeyboardSuppressed();
  // Ref porque o efeito grande do useTerminalSurface (deps [wsUrl, projectId,
  // agentId]; wsUrl deriva de sessionKey) DERRUBA/RECRIA o Terminal + o WebSocket. Acrescentar `keyboardSuppressed`
  // ali reconectaria o PTY a cada toque no toggle — inaceitável. O ref é lido de
  // dentro dos handlers/efeitos existentes sem entrar em dependência nenhuma.
  // Escrito durante o render (não num efeito) de propósito: assim o `term.focus()`
  // do mount já vê o valor correto e não existe janela em que o teclado pisca
  // aberto num reload com o modo ligado.
  const keyboardSuppressedRef = useRef(keyboardSuppressed);
  keyboardSuppressedRef.current = keyboardSuppressed;

  // Fase V-2: o visualizador de arquivos. `null` fora do ViewerProvider (este
  // componente é montado isolado em vários testes) — quem usa checa. Ref pelo
  // mesmo motivo do `keyboardSuppressedRef`: o efeito grande do useTerminalSurface
  // recria o Terminal e o WebSocket; o contexto NÃO pode entrar nas dependências de lá.
  // Só as ações (identidade estável): este painel não re-renderiza a cada aba.
  const viewer = useViewerActions();
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;


  // xterm + PTY WebSocket lifecycle lives in src/terminal; everything V2-specific
  // (viewer, overlays, tokens) is injected here.
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const { status: connectionStatus, sendControlByte, pasteText, refit, termRef, closeSocket } = useTerminalSurface({
    containerRef,
    wsUrl: `${protocol}//${window.location.host}/ws/pty/${sessionKey}`,
    projectId,
    agentId,
    visible,
    theme: resolveTerminalTheme,
    linkProviders: [
      (term) => createFilePathLinkProvider(
        term,
        (path, line) => {
          viewerRef.current?.openByPath(sessionScope(sessionKey), path, { linha: line ?? undefined });
        },
        () => !!viewerRef.current,
      ),
    ],
    onOpenLink: openWebLink,
    onControlFrame: (controlFrame) => {
      if (controlFrame.type === 'resume_failed') {
        setResumeFailed(true);
      } else if (controlFrame.type === 'spawn_failed') {
        setSpawnFailedDetail(controlFrame.detail || 'Comando do agente não pôde ser iniciado.');
      } else if (controlFrame.type === 'viewer_open') {
        // A aba já está gravada no banco antes do frame sair; sem
        // Provider (teste isolado) o frame é só descartado — nunca
        // escrito no terminal como texto.
        viewerRef.current?.receiveOpen(
          sessionKey,
          controlFrame.item,
          !!controlFrame.reused,
          Array.isArray(controlFrame.evicted) ? controlFrame.evicted : [],
        );
      }
    },
    onStatusChange: (status) => {
      if (status === 'open') {
        // A fresh connection either gets a working PTY or a new resume_failed
        // frame if it fails again — either way, any overlay from a previous
        // connection attempt on this same socket lineage is stale.
        setResumeFailed(false);
        setResetError(false);
        setSpawnFailedDetail(null);
      }
    },
    keyboardSuppressedRef,
  });

  // Expose sendControlByte for the IpadToolbar via ref (TERM-03)
  useImperativeHandle(ref, () => ({
    sendControlByte,
    // Layout v2 "Ajustar layout" button: user-triggered fit + focus, never a
    // session restart (details in useTerminalSurface.refit).
    forceFit: refit,
    // Rodada 2, Frente C: cola via term.paste(), NUNCA via sendControlByte
    // (bracketed paste; details in useTerminalSurface.pasteText).
    pasteText,
  }), [sendControlByte, refit, pasteText]);

  // Rodada 2, Frente C: o mecanismo do modo "esconder teclado".
  //
  // `term.textarea.readOnly` e nada mais. A textarea é API pública do xterm
  // (`readonly textarea: HTMLTextAreaElement | undefined`), o xterm não escreve
  // `readonly` nem `inputmode` nela, e o iOS só mostra o teclado de tela para um
  // campo MUTÁVEL com foco. O que isto preserva, e é o ponto:
  //  - os 8 atalhos do painel continuam funcionando: eles não passam pela
  //    textarea, vão direto de sendControlByte -> ws.send -> proc.write;
  //  - o paste continua funcionando: o evento `paste` dispara mesmo em alvo não
  //    editável, e o handler do xterm lê de `clipboardData` em vez de esperar o
  //    UA inserir texto (ele até limpa a textarea depois);
  //  - o teclado FÍSICO continua digitando — o Bruno usa Magic Keyboard no iPad,
  //    e o modo existe para o teclado DE TELA.
  //
  // NÃO trocar por `term.options.disableStdin = true`: ele faz
  // `coreService.triggerDataEvent` retornar cedo, e o caminho do paste do xterm
  // TERMINA em triggerDataEvent — quebraria o paste nativo, o pasteText() do
  // botão de colar e a digitação do teclado físico, tudo de uma vez.
  // `inputmode="none"` também está refutado: o Safari mostra o teclado mesmo
  // assim.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    // C-R1: `textarea` é `undefined` antes de open() e depois de dispose().
    const textarea = term.textarea;
    if (!textarea) return;
    textarea.readOnly = keyboardSuppressed;
    // UM blur, e só na transição para "suprimido". Se a textarea está focada com
    // o teclado já na tela no instante em que o usuário marca o toggle,
    // `readOnly` sozinho NÃO retira o teclado que já está aberto — o iOS só o
    // retira num blur — e um botão "esconder teclado" que não esconde o teclado
    // no único momento em que o usuário está olhando para ele é pior que não
    // existir. Depois disso não refocamos nem blurramos mais nada: o próximo
    // toque no terminal refoca a textarea (já readOnly), o cursor volta a
    // acender e nenhum teclado sobe. Consequência visível e aceita: o cursor do
    // xterm fica oco até esse próximo toque.
    if (keyboardSuppressed && document.activeElement === textarea) {
      textarea.blur();
    }
  }, [keyboardSuppressed]);

  // Bug 2 fix: order matters here — reset() must resolve BEFORE the socket is
  // closed. Closing first would let the existing onclose reconnect handler
  // race ahead and reconnect with the OLD claude_session_id still mapped,
  // reopening the same "No conversation found" failure. Resetting first
  // clears that mapping, so the reconnect that onclose schedules next lands
  // on the resume=False branch server-side and spawns a clean session.
  const handleStartNewConversation = async () => {
    setResetError(false);
    try {
      await api.resetSession(sessionKey);
    } catch (err) {
      console.error('Falha ao reiniciar sessão', err);
      setResetError(true);
      return;
    }
    setResumeFailed(false);
    closeSocket();
  };

  return (
    <div style={skin.root}>
      {connectionStatus === 'reconnecting' && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          padding: '8px 16px',
          fontSize: '12px',
          lineHeight: 1.4,
          color: '#ff3333',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid #ff3333',
        }}>
          Conexão encerrada com o servidor. Tentando reconectar automaticamente...
        </div>
      )}
      {connectionStatus === 'evicted' && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          padding: '8px 16px',
          fontSize: '12px',
          lineHeight: 1.4,
          color: 'var(--text-muted)',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)',
        }}>
          Esta sessão foi aberta em outro dispositivo ou aba. Selecione o agente novamente ou recarregue a página para reconectar aqui.
        </div>
      )}
      {resumeFailed && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          padding: '8px 16px',
          fontSize: '12px',
          lineHeight: 1.4,
          color: 'var(--text-primary)',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <span>Esta sessão não pôde ser retomada. Iniciar uma nova conversa?</span>
            <button
              onClick={handleStartNewConversation}
              style={{
                padding: '4px 12px',
                fontSize: '12px',
                background: 'var(--accent-green)',
                color: '#111',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Iniciar nova conversa
            </button>
          </div>
          {resetError && (
            <span style={{ color: '#ff3333' }}>
              Falha ao reiniciar. Tentando novamente pode funcionar.
            </span>
          )}
        </div>
      )}
      {spawnFailedDetail && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          padding: '8px 16px',
          fontSize: '12px',
          lineHeight: 1.4,
          color: 'var(--text-primary)',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid #ff3333',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}>
          <span>Não foi possível iniciar o comando deste agente.</span>
          <span style={{ color: 'var(--text-muted)' }}>{spawnFailedDetail}</span>
          <span style={{ color: 'var(--text-muted)' }}>
            Verifique nas configurações (⚙) se o campo "comando" desse agente é um executável real (ex.: "claude --settings ~/.claude-work"), não um alias/atalho do seu terminal.
          </span>
        </div>
      )}
      {/*
        Two nested divs, not one, on purpose (see .planning/debug/terminal-cursor-desalinhado.md):
        @xterm/addon-fit's FitAddon.proposeDimensions() reads
        getComputedStyle(this._terminal.element.parentElement) — i.e. THIS component's
        term.open() target — as the available width/height, and only subtracts the
        padding of xterm's own internal `.xterm` element (always 0), never the padding
        of its own parentElement. Combined with the global `box-sizing: border-box`
        reset (index.css), a padded parentElement makes getComputedStyle(...).width
        include that padding, so FitAddon over-counts cols/rows by the padding amount —
        desyncing the PTY-reported terminal size from the true visible area (matches
        xterm.js upstream issue #1283, unresolved as of writing). The fix: keep the
        padding on an OUTER wrapper and give the term.open() target (containerRef)
        zero padding of its own, so FitAddon's parentElement measurement is exact.
      */}
      {/*
        A MOLDURA. Toda a geometria vem inline do skin (testável sem CSS); só a
        COR da borda e sua transição moram em `.v2-terminal-frame` no theme.css,
        porque têm estado (`:focus-within`) — e estilo inline vence classe por
        especificidade, então um `border: '1px solid …'` aqui mataria a regra de
        foco em silêncio.
      */}
      <div className={skin.frameClassName} style={skin.frame}>
        {/*
          `data-terminal-viewport` marca o nó do term.open() para os testes de
          INV-TERM-GEOM: com o Vitest rodando `css: false`, um padding que
          migrasse daqui para uma classe passaria invisível ao getComputedStyle.
          Por isso o teste assevera também que este nó NÃO tem className.
        */}
        <div ref={containerRef} data-terminal-viewport style={skin.viewport} />
      </div>
    </div>
  );
});
