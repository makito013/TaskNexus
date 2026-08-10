// frontend/src/layouts/v2/ResetLayoutButton.jsx
//
// Layout v2, Chat: botão "Ajustar layout" na topbar. Pedido original do
// Bruno: quando o terminal aparece com espaço sobrando/cortado no tablet, um
// clique força o layout de volta ao normal — SEM nunca reiniciar a
// sessão/PTY. Só afeta a sessão ativa (a que activePanelRef aponta), e só
// existe no Layout v2 (renderizado condicionalmente por AppV2.jsx, não por
// este componente).
//
// Mecanismo: activePanelRef.current é o TerminalPanel ativo (ref callback em
// ChatV2.jsx, mesmo padrão de layouts/v1/AppV1.jsx). forceFit() (exposto via
// useImperativeHandle em TerminalPanel.jsx) chama fitAddon.fit() + focus(),
// nada de rede/WebSocket — reajusta as dimensões do terminal sem tocar na
// conexão nem no processo PTY do servidor.
import { useEffect, useRef, useState } from 'react';

const FEEDBACK_DURATION_MS = 900;

const styles = {
  button: (disabled) => ({
    flexShrink: 0,
    height: '28px',
    padding: '0 12px',
    fontSize: '12px',
    fontWeight: 600,
    borderRadius: '8px',
    border: '1px solid var(--v2-border)',
    background: 'transparent',
    color: disabled ? 'var(--v2-text-faint)' : 'var(--v2-text)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }),
};

export function ResetLayoutButton({ activePanelRef, disabled }) {
  const [justReset, setJustReset] = useState(false);
  const timerRef = useRef(null);

  // Cleanup: a pending "voltar ao label normal" timer não pode disparar (nem
  // gerar warning de "act" em teste) depois que este componente desmontar —
  // ex.: usuário navega pra outra tela do v2 logo após clicar.
  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleClick = () => {
    // Defensivo: se disabled estiver certo (activeSessionKey != null) isso
    // nunca deveria ser null, mas um clique nunca deve quebrar a UI caso o
    // ref ainda não tenha sido anexado.
    activePanelRef?.current?.forceFit();

    setJustReset(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setJustReset(false);
    }, FEEDBACK_DURATION_MS);
  };

  return (
    <button
      type="button"
      style={styles.button(disabled)}
      onClick={handleClick}
      disabled={disabled}
      title="Reajusta o terminal ao espaço disponível, sem reiniciar a sessão"
    >
      {justReset ? '✓ Ajustado' : '↺ Ajustar layout'}
    </button>
  );
}
