import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '../../components/Button/Button.jsx'
import Dialog from '../../components/Dialog/Dialog.jsx'
import { chatApi } from '../../../../services/chatApi.js'
import './ChatLeaf.css'

const TITLE_ID = 'dlg-chat-connectors-title'

// "Conectores no chat — {Agente}" (Designer 9, R-CONECT): which connectors of the user's Claude account
// the agent's chats may use. Every switch starts OFF (the list comes from the server: only the names
// the user allowed are on). Only names and the on/off state are shown, never a credential; a name is
// text. It is one of the writers of chatApi (chatWriteGuard): PUT the allowlist and POST refresh.
//
// Wording: with a partial allowlist the connectors that are not allowed stay connected and only their
// tools are unavailable, so nothing here promises that a connector "does not load".
//   agentId / agentName   whose list it is
//   onClose()             Fechar, Esc, the close button
//   returnFocusTo         where the focus goes back to (the "⋯" item that opened it is gone)
const REASON_PARTIAL = 'Por enquanto só é possível manter todos desligados.'

function sameSet(a, b) {
  return a.size === b.size && [...a].every((name) => b.has(name))
}

function allowedNames(payload) {
  const known = Array.isArray(payload?.known) ? payload.known : []
  return new Set(known.filter((entry) => entry.allowed).map((entry) => entry.name))
}

export default function ConnectorsDialog({ agentId, agentName, onClose, returnFocusTo = null }) {
  // phase: loading | ready | missing (404) | failed
  const [load, setLoad] = useState({ phase: 'loading', known: [], saved: new Set() })
  const [selected, setSelected] = useState(() => new Set())
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState(null) // { tone: 'ok' | 'err', text }
  const firstSwitchRef = useRef(null)

  const adopt = useCallback((payload, { keepSelection = false } = {}) => {
    const known = (Array.isArray(payload?.known) ? payload.known : []).map((entry) => String(entry.name))
    const saved = allowedNames(payload)
    setLoad({ phase: 'ready', known, saved })
    setSelected((current) => (keepSelection ? new Set([...current].filter((name) => known.includes(name))) : new Set(saved)))
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoad({ phase: 'loading', known: [], saved: new Set() })
    chatApi.fetchConnectors(agentId).then(
      (payload) => {
        if (!cancelled) adopt(payload)
      },
      (error) => {
        if (!cancelled) setLoad({ phase: error?.status === 404 ? 'missing' : 'failed', known: [], saved: new Set() })
      },
    )
    return () => {
      cancelled = true
    }
  }, [agentId, attempt, adopt])

  // The first switch takes the focus once the list is there (the dialog opened while it was loading).
  useEffect(() => {
    if (load.phase === 'ready') firstSwitchRef.current?.focus()
  }, [load.phase])

  const dirty = load.phase === 'ready' && !sameSet(selected, load.saved)

  const toggle = (name) => {
    if (saving) return
    setNotice(null)
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const save = async () => {
    if (!dirty || saving) return
    setSaving(true)
    setNotice(null)
    try {
      const payload = await chatApi.putConnectors(agentId, load.known.filter((name) => selected.has(name)))
      adopt(payload)
      setNotice({ tone: 'ok', text: 'Salvo. Reabra ou retome os chats abertos deste agente para aplicar.' })
    } catch (error) {
      setNotice({
        tone: 'err',
        text: error?.code === 'partial_allowlist_unavailable' ? REASON_PARTIAL : 'Não foi possível salvar. Nada foi alterado.',
      })
    } finally {
      setSaving(false)
    }
  }

  const refresh = async () => {
    if (refreshing || saving) return
    setRefreshing(true)
    setNotice(null)
    try {
      adopt(await chatApi.refreshConnectors(agentId), { keepSelection: true })
    } catch {
      setNotice({ tone: 'err', text: 'Não foi possível atualizar a lista. Tente de novo.' })
    } finally {
      setRefreshing(false)
    }
  }

  const title = agentName ? `Conectores no chat — ${agentName}` : 'Conectores no chat'
  return (
    <Dialog
      open
      size="narrow"
      title={title}
      titleId={TITLE_ID}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      footer={(
        <>
          {notice?.tone === 'err' ? <p className="v3-dialog__why" role="alert">{notice.text}</p> : <span className="v3-dialog__footer-spacer" />}
          <Button onClick={onClose}>Fechar</Button>
          <Button
            variant="primary"
            aria-disabled={!dirty || saving ? 'true' : undefined}
            aria-busy={saving ? 'true' : undefined}
            onClick={save}
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      )}
    >
      <div className="v3-chat-conn">
        <p className="v3-chat-conn__intro v3-type-body-sm">
          Conectores da sua conta Claude ficam desligados por padrão. Os ligados ainda pedem sua aprovação antes de qualquer ação. Mudanças valem para chats novos ou retomados.
        </p>

        {load.phase === 'loading' ? (
          <div role="status" aria-busy="true">
            <span className="v3-chat-sr-only">Carregando conectores…</span>
            {[0, 1, 2].map((item) => <span key={item} className="v3-chat-conn__skeleton" aria-hidden="true" />)}
          </div>
        ) : null}

        {load.phase === 'missing' ? <p className="v3-msg v3-msg--warn">Este agente não existe mais.</p> : null}

        {load.phase === 'failed' ? (
          <div className="v3-chat-conn__empty">
            <p className="v3-msg v3-msg--err" role="alert">Não foi possível carregar os conectores.</p>
            <Button size="sm" onClick={() => setAttempt((count) => count + 1)}>Tentar de novo</Button>
          </div>
        ) : null}

        {load.phase === 'ready' && load.known.length === 0 ? (
          <div className="v3-chat-conn__empty">
            <p className="v3-type-body-sm">
              Nenhum conector da sua conta foi encontrado ainda. Eles aparecem depois que o agente abre um chat.
            </p>
          </div>
        ) : null}

        {load.phase === 'ready' && load.known.length > 0 ? (
          <ul className="v3-chat-conn__list">
            {load.known.map((name, index) => {
              const on = selected.has(name)
              const state = on ? 'ligado' : 'desligado'
              return (
                <li key={name} className="v3-chat-conn__row">
                  <span className="v3-chat-conn__text">
                    <span className="v3-chat-conn__name v3-type-body-sm">{name}</span>
                    <span className="v3-chat-conn__state v3-type-caption">{on ? 'Ligado' : 'Desligado'}</span>
                  </span>
                  <button
                    ref={index === 0 ? firstSwitchRef : undefined}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${name}: ${state}`}
                    className="v3-chat-switch-btn"
                    onClick={() => toggle(name)}
                  >
                    <span className="v3-chat-switch-btn__thumb" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}

        {load.phase === 'ready' ? (
          <Button
            size="sm"
            variant="text"
            aria-busy={refreshing ? 'true' : undefined}
            aria-disabled={refreshing ? 'true' : undefined}
            onClick={refresh}
          >
            {refreshing ? 'Atualizando…' : 'Atualizar lista'}
          </Button>
        ) : null}

        {notice?.tone === 'ok' ? <p className="v3-chat-conn__saved v3-type-body-sm" role="status">{notice.text}</p> : null}
      </div>
    </Dialog>
  )
}
