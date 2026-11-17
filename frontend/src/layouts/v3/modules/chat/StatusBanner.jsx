import Button from '../../components/Button/Button.jsx'
import './ChatLeaf.css'

export const FAILURE_BANNER_KINDS = ['spawn_failed', 'resume_failed', 'engine_unavailable']

const CLI_REASONS = new Set(['cli_not_found', 'cli_invalid', 'cli_version_unsupported'])

// R-REC (Designer 6): the banner of a status the server reported (reducer `banner`). Texts are the
// Designer's, verbatim. Actions are ids the screen maps to behaviour:
//   retry            "Tentar de novo" / "Abrir de novo"  (open the conversation again)
//   new_conversation "Iniciar nova conversa"             (reset)
//   connectors       "Conectores no chat"                (only offered when the screen can open it)
export function describeBanner(banner, { canOpenConnectors = false } = {}) {
  switch (banner?.kind) {
    case 'spawn_failed': {
      if (CLI_REASONS.has(banner.reason)) {
        return {
          tone: 'danger',
          title: 'Não foi possível iniciar o chat',
          text: 'O claude não foi encontrado ou está desatualizado. Instale ou atualize o claude, ou defina CHAT_CLI_PATH, e tente de novo.',
          actions: [{ id: 'retry', label: 'Tentar de novo' }],
        }
      }
      if (banner.reason === 'folder_unavailable') {
        return {
          tone: 'danger',
          title: 'Não foi possível iniciar o chat',
          text: 'A pasta do projeto não foi encontrada. Verifique o projeto.',
          actions: [{ id: 'retry', label: 'Tentar de novo' }],
        }
      }
      if (banner.reason === 'connector_exposed') {
        return {
          tone: 'danger',
          title: 'O chat foi encerrado por segurança',
          text: 'Um conector da sua conta que não está liberado apareceu na sessão. Nada foi executado por ele.',
          actions: [
            { id: 'retry', label: 'Abrir de novo' },
            ...(canOpenConnectors ? [{ id: 'connectors', label: 'Conectores no chat', text: true }] : []),
          ],
        }
      }
      return {
        tone: 'danger',
        title: 'Não foi possível iniciar o chat',
        text: 'Tente de novo em instantes.',
        detail: banner.detail || banner.reason || null,
        actions: [{ id: 'retry', label: 'Tentar de novo' }],
      }
    }
    case 'engine_unavailable':
      return {
        tone: 'danger',
        title: 'O chat ainda não está disponível neste servidor',
        text: 'Falta atualizar as dependências. Peça um deploy normal ou rode pip install -r.',
        actions: [],
      }
    case 'resume_failed':
      return {
        tone: 'danger',
        title: 'Não foi possível retomar esta conversa',
        text: 'O histórico abaixo continua guardado, mas o agente não lembra dele.',
        actions: [{ id: 'new_conversation', label: 'Iniciar nova conversa', primary: true }],
      }
    case 'history_import_failed':
      return {
        tone: 'tiq',
        title: 'Não foi possível importar o histórico',
        text: 'Ele continua disponível no terminal.',
        actions: [],
      }
    default:
      return null
  }
}

// The network states of the socket (never server events). Wording of the "too many tabs" and
// "forbidden" cases is the TL's / assumed: the Designer's table has no row for them.
export function describeConnection(connection) {
  switch (connection?.state) {
    case 'reconnecting':
      return {
        tone: 'fin',
        title: 'Reconectando…',
        text: 'Repetindo os eventos que você perdeu. Seu rascunho está guardado.',
        spinner: true,
        actions: [],
      }
    case 'offline':
      return {
        tone: 'fin',
        title: 'Sem conexão',
        text: 'Não conseguimos falar com o servidor. Seu rascunho está guardado.',
        actions: [{ id: 'retry_now', label: 'Tentar agora' }],
      }
    case 'too_many_readers':
      return {
        tone: 'fin',
        title: 'Muitas abas abertas nesta conversa',
        text: 'Feche as outras abas desta conversa e tente de novo.',
        actions: [{ id: 'retry_now', label: 'Tentar agora' }],
      }
    case 'forbidden':
      return {
        tone: 'danger',
        title: 'Este endereço não pode abrir o chat',
        text: 'Abra o TaskNexus pelo endereço habitual e tente de novo.',
        actions: [],
      }
    default:
      return null
  }
}

const ROLE = { danger: 'alert', fin: 'status', tiq: 'note' }

function Banner({ spec, id, onAction }) {
  return (
    <div id={id} className={`v3-chat-banner v3-chat-banner--${spec.tone}`} role={ROLE[spec.tone]}>
      {spec.spinner ? <span className="v3-chat-banner__spinner" aria-hidden="true" /> : <span className="v3-chat-banner__dot" aria-hidden="true" />}
      <div className="v3-chat-banner__body">
        <b className="v3-chat-banner__title">{spec.title}</b>
        <p className="v3-chat-banner__text v3-type-body-sm">{spec.text}</p>
        {spec.detail ? (
          <details className="v3-chat-banner__detail">
            <summary>Detalhe técnico</summary>
            <pre className="v3-type-mono-sm">{spec.detail}</pre>
          </details>
        ) : null}
      </div>
      {spec.actions.length > 0 ? (
        <div className="v3-chat-banner__actions">
          {spec.actions.map((action) => (
            <Button
              key={action.id}
              variant={action.primary ? 'primary' : action.text ? 'text' : 'secondary'}
              onClick={() => onAction(action.id)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export const FAILURE_BANNER_ID = 'chat-failure-banner'

// The banners over the thread: the network one first, then the server status one.
export default function StatusBanner({ banner, connection, canOpenConnectors = false, onAction }) {
  const network = describeConnection(connection)
  const status = describeBanner(banner, { canOpenConnectors })
  if (!network && !status) return null
  return (
    <div className="v3-chat-banners">
      {network ? <Banner spec={network} id="chat-network-banner" onAction={onAction} /> : null}
      {status ? <Banner spec={status} id={FAILURE_BANNER_ID} onAction={onAction} /> : null}
    </div>
  )
}
