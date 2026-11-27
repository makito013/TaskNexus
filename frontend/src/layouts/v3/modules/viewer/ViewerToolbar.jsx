import { useEffect, useRef, useState } from 'react'
import { useSaveToArtifacts } from '../../../../hooks/useSaveToArtifacts.js'
import { openerLabel } from '../../../../hooks/viewerState.jsx'
import { SOURCE_VIEWER, fileUrl } from '../../../../services/viewerApi.js'
import { copyTextToClipboard } from '../../../../utils/clipboard.js'
import { basenameOf, formatBytes, formatRelativeSeconds } from '../../../../utils/viewerPaths.js'
import { useToast } from '../../components/Toast/toastContext.js'
import ViewerFileMenu from './ViewerFileMenu.jsx'

const FEEDBACK_MS = 2000

// "Copiado" / "Não consegui copiar" for two seconds. A copy that settles after the toolbar left changes nothing.
function useCopyFeedback() {
  const [feedback, setFeedback] = useState(null)
  const timer = useRef(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimeout(timer.current)
    }
  }, [])
  const copy = async (text) => {
    let ok = false
    try {
      ok = await copyTextToClipboard(text)
    } catch {
      ok = false
    }
    if (!mounted.current) return
    setFeedback(ok ? 'ok' : 'fail')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setFeedback(null), FEEDBACK_MS)
  }
  return [feedback, copy]
}

// The bar of the open file: path, size, who opened it, and the actions. "Baixar" and "Abrir no navegador" are
// real links (a tapped link is what makes Safari download and what the installed app does not block).
// "Copiar" copies the text of a text file and the path of anything else (V2 parity, K7).
// "Salvar em Artefatos" shows only for a tab of a conversation (.md/.html/.pdf of a project) that is not an
// artifact yet; the POST is idempotent (201 = new, 200 = it already was).
//   status   'ready' | 'gone' | ... (a vanished file has nothing to download)
export default function ViewerToolbar({ item, content, status = 'ready', onCloseTab }) {
  const [feedback, copy] = useCopyFeedback()
  const saver = useSaveToArtifacts(item)
  const toast = useToast()
  if (!item) return null

  const text = typeof content?.text === 'string' && content.text !== '' ? content.text : null
  const size = Number.isFinite(content?.size) ? formatBytes(content.size) : null
  const when = formatRelativeSeconds(item.updated_at)
  const fromChat = (item.source || SOURCE_VIEWER) === SOURCE_VIEWER
  const openedBy = fromChat
    ? `aberto ${item.opened_by === 'user' ? 'por você' : `pelo ${openerLabel(item, item.session_key)}`}${when ? ` ${when}` : ''}`
    : null
  const browserUrl = fileUrl(item)
  const showSave = saver.status === 'available' || saver.status === 'saving' || saver.status === 'saved'
  const save = async () => {
    if (saver.status !== 'available') return
    const result = await saver.save()
    if (result.ok) toast.push({ text: result.created ? 'Salvo em Artefatos.' : 'Já estava em Artefatos.' })
    else toast.push({ text: 'Não consegui salvar em Artefatos.', kind: 'error' })
  }

  return (
    <div className="v3-viewer-toolbar">
      <div className="v3-viewer-toolbar__meta">
        <span className="v3-viewer-toolbar__path v3-type-mono-sm" title={item.path}>{item.path}</span>
        {size ? <span className="v3-viewer-toolbar__size v3-type-mono-sm">{size}</span> : null}
        {openedBy ? <span className="v3-viewer-toolbar__opened v3-type-caption">{openedBy}</span> : null}
      </div>
      <div className="v3-viewer-toolbar__actions" role="group" aria-label="Ações do arquivo">
        {showSave ? (
          <button
            type="button"
            className="v3-viewer-text-button"
            data-viewer-save=""
            aria-busy={saver.status === 'saving' ? 'true' : undefined}
            aria-disabled={saver.status === 'available' ? undefined : 'true'}
            onClick={save}
          >
            {saver.status === 'saving' ? 'Salvando…' : saver.status === 'saved' ? '★ Salvo' : '☆ Salvar em Artefatos'}
          </button>
        ) : null}
        {status === 'gone' ? null : (
          <a
            className="v3-viewer-text-button"
            href={fileUrl(item, item.path, { download: true })}
            download={content?.name || basenameOf(item.path)}
          >
            Baixar
          </a>
        )}
        <button type="button" className="v3-viewer-text-button" onClick={() => copy(text ?? item.path)}>Copiar</button>
        <a className="v3-viewer-text-button" href={browserUrl} target="_blank" rel="noopener noreferrer">Abrir no navegador</a>
        <ViewerFileMenu
          label="Mais ações do arquivo"
          items={[
            { id: 'copy-path', label: 'Copiar caminho', onSelect: () => copy(item.path) },
            { id: 'open', label: 'Abrir no navegador', href: browserUrl },
            { id: 'close', label: 'Fechar aba', onSelect: () => onCloseTab?.() },
          ]}
        />
      </div>
      {feedback ? (
        <span className="v3-viewer-toolbar__feedback v3-type-caption" role={feedback === 'ok' ? 'status' : 'alert'}>
          {feedback === 'ok' ? 'Copiado' : 'Não consegui copiar'}
        </span>
      ) : null}
    </div>
  )
}
