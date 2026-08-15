// frontend/src/hooks/useKeyboardSuppressed.js
//
// Preferência "esconder teclado" do terminal (Rodada 2, Frente C). Pedido do
// Bruno, nas palavras dele: com o modo ligado "o teclado n abre de jeito
// nenhum", pra ele conseguir LER a saída do `claude` no iPad sem o teclado
// virtual subindo a cada toque no terminal.
//
// O mecanismo em si (`term.textarea.readOnly = true`) mora em
// components/TerminalPanel.jsx; este hook é só o dono do BOOLEANO: onde ele
// persiste e como três componentes distantes na árvore ficam sabendo dele.
//
// POR QUE HOOK + CustomEvent, e não estado levantado até o ChatV2 com props:
// os três consumidores são layouts/v2/TerminalShortcutsPanel.jsx (renderiza o
// toggle), components/TerminalPanel.jsx (aplica o efeito) e
// layouts/v2/TerminalShortcutsFab.jsx (o ponto indicador). O TerminalPanel é
// montado pelo ChatV2, mas o toggle vive dentro do FAB -> painel, dois níveis
// abaixo: seriam 4 props novas atravessando dois componentes para transportar
// um booleano, e mexeriam na assinatura do ChatV2.jsx — arquivo em zona de
// colisão com outra frente. Precedente exato deste padrão no repo:
// hooks/useSidebarCollapsed.js dispara `escritorio:sidebar-toggled` e o
// TerminalPanel escuta, fora da árvore React.
import { useCallback, useEffect, useRef, useState } from 'react';

// Prefixo `escritorio::` é o namespace já em uso por
// `escritorio::sidebar_collapsed` e `escritorio::terminal_shortcuts_fab_position`.
// O produto virou TaskNexus, mas trocar o prefixo tornaria órfãs as
// preferências vivas no localStorage do iPad do Bruno.
//
// O escopo é POR DISPOSITIVO de graça: `localStorage` já é por origem +
// dispositivo. Não inventar device-id nenhum aqui.
export const KEYBOARD_SUPPRESSED_STORAGE_KEY = 'escritorio::terminal_keyboard_suppressed';

// Nome no mesmo formato de `escritorio:sidebar-toggled` (um só `:` depois do
// namespace, como manda a convenção de eventos deste repo — não confundir com
// o `::` das chaves de storage).
export const KEYBOARD_SUPPRESSED_EVENT = 'escritorio:terminal-keyboard-suppressed';

/**
 * readStoredKeyboardSuppressed — leitura tolerante da preferência.
 *
 * `String(boolean)` (`'true'`/`'false'`), formato IDÊNTICO ao de
 * useSidebarCollapsed.js — não inventar `'1'`/`'0'`, senão duas preferências
 * do mesmo repo passam a ter dois formatos e a próxima pessoa erra a leitura.
 *
 * O try/catch não é cosmético: o Safari em modo privado LANÇA já na leitura de
 * localStorage, e o modo privado do iPad é um cenário real do Bruno. Sem ele o
 * componente inteiro estoura no primeiro render.
 */
function readStoredKeyboardSuppressed() {
  try {
    const stored = localStorage.getItem(KEYBOARD_SUPPRESSED_STORAGE_KEY);
    if (stored !== null) return stored === 'true';
  } catch { /* ignore */ }
  // Default explícito: sem preferência salva o teclado funciona normalmente.
  // Um modo que suprime o teclado NUNCA pode ser o default — o usuário novo
  // não teria como descobrir por que não consegue digitar.
  return false;
}

export function useKeyboardSuppressed() {
  const [suppressed, setSuppressed] = useState(readStoredKeyboardSuppressed);

  // Espelho do estado num ref pra que `toggle` calcule o próximo valor FORA do
  // updater do setState. Escrever no localStorage e disparar o CustomEvent
  // dentro do updater seria efeito colateral numa função que o React pode
  // invocar duas vezes (StrictMode) — daria duas escritas e dois eventos por
  // toque. A alternativa (ler `suppressed` direto) obrigaria a colocá-lo nas
  // deps do useCallback, recriando a callback a cada mudança de estado.
  const suppressedRef = useRef(suppressed);
  suppressedRef.current = suppressed;

  useEffect(() => {
    // Espelha o valor vindo de OUTRA instância do hook. É isto que mantém
    // TerminalPanel/FAB/painel em sincronia sem prop-drilling.
    const onSuppressionChanged = (event) => {
      setSuppressed(!!event.detail);
    };
    window.addEventListener(KEYBOARD_SUPPRESSED_EVENT, onSuppressionChanged);
    return () => window.removeEventListener(KEYBOARD_SUPPRESSED_EVENT, onSuppressionChanged);
  }, []);

  const toggle = useCallback(() => {
    const next = !suppressedRef.current;
    // Persiste ANTES de notificar: se o setItem lançar (Safari privado), o
    // estado em memória ainda muda e a UI responde ao toque — só não sobrevive
    // ao reload. A ordem inversa daria um instante em que outro consumidor já
    // reagiu a um valor que nunca foi gravado.
    try {
      localStorage.setItem(KEYBOARD_SUPPRESSED_STORAGE_KEY, String(next));
    } catch { /* ignore — persistir uma preferência nunca deve quebrar a UI */ }
    suppressedRef.current = next;
    setSuppressed(next);
    // O `detail` carrega o valor NOVO em vez de deixar cada listener reler o
    // localStorage: o storage pode ter falhado na linha acima e mesmo assim a
    // sessão atual precisa ficar consistente entre os três consumidores.
    window.dispatchEvent(new CustomEvent(KEYBOARD_SUPPRESSED_EVENT, { detail: next }));
  }, []);

  return [suppressed, toggle];
}
