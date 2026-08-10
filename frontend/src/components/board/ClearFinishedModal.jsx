// frontend/src/components/board/ClearFinishedModal.jsx
// Bottom sheet de confirmação de "Limpar concluídos" (Designer 05-DESIGNER.md
// seção 11.3; spec visual/comportamental em 05-mockup.html — classes
// #confirm-sheet/#confirm-sheet-backdrop e funções openConfirmSheet/
// closeConfirmSheet/executeClearFinished). 05-TL.md Tarefa 25.
//
// Segue a MESMA estrutura visual de bottom sheet de MoveCardMenu.jsx
// (backdrop fixed + folha ancorada no rodapé, --radius-lg, --touch-target)
// para consistência entre os dois bottom sheets do app, mas com conteúdo
// próprio — não reaproveita o componente literalmente (MoveCardMenu é uma
// lista de opções; este é uma confirmação com estados assíncronos).
//
// Diferente de MoveCardMenu, este componente NÃO pode retornar `null` antes
// dos hooks — precisa rodar `useEffect` para disparar `onPreview` sempre que
// `open` vira `true`, então os hooks ficam incondicionais no topo e o
// `if (!open) return null` vem depois deles.
//
// Máquina de estados (`phase`):
// - 'loading'   — preview em andamento (logo após abrir).
// - 'empty'     — preview resolveu com `cards === 0` (nada para apagar).
// - 'ready'     — preview resolveu com `cards > 0`, aguardando confirmação.
// - 'executing' — `onExecute` em andamento (botões desabilitados, "Apagando…").
// - 'error'     — `onPreview` ou `onExecute` rejeitou; nunca fica travado em
//   'loading'/'executing' para sempre.
//
// `imagens_com_falha` (presente na resposta de `onPreview`/`onExecute`,
// 05-ARQUITETO.md `LimparConcluidosResult`) é DELIBERADAMENTE nunca lido
// nem renderizado aqui — decisão do Designer (seção 11.3): é um detalhe
// operacional interno (arquivo órfão em disco, best-effort) sem ação
// possível do lado do usuário, e mostrá-lo alarmaria à toa.

import { useEffect, useState } from 'react';

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 400,
  },
  sheet: {
    position: 'fixed',
    left: '50%',
    bottom: 0,
    transform: 'translateX(-50%)',
    width: '420px',
    maxWidth: '92vw',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-strong)',
    borderBottom: 'none',
    borderTopLeftRadius: 'var(--radius-lg)',
    borderTopRightRadius: 'var(--radius-lg)',
    zIndex: 401,
    overflow: 'hidden',
  },
  title: {
    padding: '16px 16px 8px',
    fontSize: '12px',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  body: {
    padding: '0 16px 16px',
    fontSize: '14px',
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
  },
  errorBody: {
    padding: '0 16px 16px',
    fontSize: '14px',
    color: 'var(--destructive)',
    lineHeight: 1.5,
  },
  strong: {
    color: 'var(--text-primary)',
  },
  action: (disabled) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 'var(--touch-target)',
    borderTop: '1px solid var(--border)',
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box',
    background: 'transparent',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  }),
  destructive: {
    color: 'var(--destructive)',
  },
  cancel: {
    color: 'var(--text-secondary)',
    background: 'var(--bg-surface-2)',
  },
};

export function ClearFinishedModal({ open, projetoId, projetoNome, onPreview, onExecute, onClose, onSuccess }) {
  const [phase, setPhase] = useState('loading');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);

  // Dispara o preview toda vez que a folha abre (ou o projeto/preview
  // mudam enquanto ela já está aberta). `cancelled` evita setState numa
  // resposta que chegou depois de a folha já ter fechado/trocado.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setPhase('loading');
    setError(null);
    setPreview(null);
    onPreview(projetoId)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setPhase(result.cards === 0 ? 'empty' : 'ready');
      })
      .catch(() => {
        if (cancelled) return;
        setError('Não foi possível carregar o preview. Tente novamente.');
        setPhase('error');
      });
    return () => { cancelled = true; };
  }, [open, projetoId, onPreview]);

  if (!open) return null;

  const handleExecute = () => {
    setPhase('executing');
    setError(null);
    onExecute(projetoId)
      .then((result) => {
        onSuccess(result);
        onClose();
      })
      .catch(() => {
        setError('Não foi possível apagar os cards concluídos. Tente novamente.');
        setPhase('error');
      });
  };

  const executing = phase === 'executing';

  let bodyContent;
  if (phase === 'loading') {
    bodyContent = <div style={styles.body}>Carregando…</div>;
  } else if (phase === 'error') {
    bodyContent = <div style={styles.errorBody}>{error}</div>;
  } else if (phase === 'empty') {
    bodyContent = <div style={styles.body}>Nenhum card concluído neste projeto ainda.</div>;
  } else {
    // 'ready' ou 'executing' — preview já resolvido com cards > 0.
    bodyContent = (
      <div style={styles.body}>
        Isso vai apagar permanentemente{' '}
        <strong style={styles.strong}>{preview.cards} cards</strong> (incluindo
        subcards) e <strong style={styles.strong}>{preview.imagens} imagens</strong>{' '}
        do projeto <strong style={styles.strong}>{projetoNome}</strong>. Essa ação
        não pode ser desfeita.
      </div>
    );
  }

  const showDestructiveAction = phase === 'ready' || phase === 'executing';
  const showOnlyClose = phase === 'empty' || phase === 'error';

  return (
    <>
      <div
        data-testid="clear-finished-backdrop"
        style={styles.backdrop}
        onClick={executing ? undefined : onClose}
      />
      <div style={styles.sheet} role="dialog" aria-label={`Limpar concluídos — ${projetoNome}`}>
        <div style={styles.title}>{`Limpar concluídos — ${projetoNome}`}</div>
        {bodyContent}
        {showDestructiveAction && (
          <button
            type="button"
            style={{ ...styles.action(executing), ...styles.destructive }}
            disabled={executing}
            onClick={handleExecute}
          >
            {executing ? 'Apagando…' : 'Apagar permanentemente'}
          </button>
        )}
        {showOnlyClose ? (
          <button type="button" style={{ ...styles.action(false), ...styles.cancel }} onClick={onClose}>
            Fechar
          </button>
        ) : (
          <button
            type="button"
            style={{ ...styles.action(executing), ...styles.cancel }}
            disabled={executing}
            onClick={onClose}
          >
            Cancelar
          </button>
        )}
      </div>
    </>
  );
}
