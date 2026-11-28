import { useId, useState } from 'react'
import {
  CARD_PRIORIDADE_LABELS,
  CARD_PRIORIDADES,
  CARD_TIPO_LABELS,
  CARD_TIPOS,
} from '../../../../utils/cardMeta.js'
import { renderMarkdown } from '../../../../utils/markdown.js'
import Button from '../../components/Button/Button.jsx'
import { DialogIcon } from '../../components/Dialog/Dialog.jsx'

// `criado_em` is epoch seconds. The day is the LOCAL one (a card made at 22:30 in Brasília is still that day).
function formatCreatedAt(epochSeconds) {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds)) return '—'
  const date = new Date(epochSeconds * 1000)
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
}

// The fields of the card dialog. Everything here is controlled by the dialog (`values`) and reports a change
// by `onChange(field, value)`; nothing is `disabled` while saving (the dialog ignores the change instead),
// so the focus never drops. This is one of the two files of the V3 that render sanitized Markdown as HTML.
//   values   { titulo, descricao, status, tipo, prazo, prioridade, projectKey }
//   groups   the destinations ({ workspaceKey, label, projects: [{ key, label }] }[]), null for a subcard

function Field({ label, id, children }) {
  return (
    <div className="v3-field">
      <label className="v3-field__label" htmlFor={id}>{label}</label>
      {children}
    </div>
  )
}

export function CardMainFields({ mode, values, titleError, hasDescription, titleRef, onChange }) {
  const ids = useId()
  // Opens rendered when the card already has a description: reading it is the reason to open it.
  const [tab, setTab] = useState(() => (mode === 'edit' && hasDescription ? 'preview' : 'edit'))
  const titleId = `${ids}-title`
  const descriptionId = `${ids}-description`
  const errorId = `${ids}-title-error`

  return (
    <>
      <div className="v3-field">
        <label className="v3-field__label" htmlFor={titleId}>Título</label>
        <input
          ref={titleRef}
          id={titleId}
          className="v3-input"
          value={values.titulo}
          autoComplete="off"
          placeholder="Título do card"
          aria-invalid={titleError ? 'true' : undefined}
          aria-describedby={titleError ? errorId : undefined}
          {...(mode === 'create' ? { 'data-autofocus': true } : {})}
          onChange={(event) => onChange('titulo', event.target.value)}
        />
        {titleError && (
          <span className="v3-msg v3-msg--err" id={errorId}>
            <DialogIcon name="alert" size={16} />
            Dê um título ao card.
          </span>
        )}
      </div>

      <div className="v3-field">
        <span className="v3-field__label" id={`${ids}-desc-label`}>Descrição (Markdown)</span>
        <div className="v3-card-tabs" role="tablist" aria-labelledby={`${ids}-desc-label`}>
          {[['edit', 'Editar'], ['preview', 'Visualizar']].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`${ids}-tab-${value}`}
              aria-selected={tab === value}
              aria-controls={`${ids}-panel`}
              className="v3-card-tabs__tab"
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-tab-${tab}`}>
          {tab === 'edit' ? (
            <>
              <label className="v3-projects__sr-only" htmlFor={descriptionId}>Descrição</label>
              <textarea
                id={descriptionId}
                className="v3-input v3-card-description"
                rows={8}
                value={values.descricao}
                placeholder="Descreva o card em Markdown"
                onChange={(event) => onChange('descricao', event.target.value)}
              />
            </>
          ) : (
            <div
              className="v3-prose v3-card-preview"
              // sanitized by DOMPurify inside renderMarkdown
              dangerouslySetInnerHTML={{ __html: values.descricao.trim() ? renderMarkdown(values.descricao) : '<p>Sem descrição.</p>' }}
            />
          )}
        </div>
      </div>
    </>
  )
}

export function CardRailFields({ mode, values, columns, doneSlug, card, groups, leaving, onChange, onPlaceGroup }) {
  const ids = useId()
  const selectedGroup = groups ? groups.findIndex((group) => group.projects.some((project) => project.key === values.projectKey)) : -1
  const group = selectedGroup >= 0 ? groups[selectedGroup] : null

  return (
    <>
      <Field label="Status" id={`${ids}-status`}>
        <select id={`${ids}-status`} className="v3-input" value={values.status} onChange={(event) => onChange('status', event.target.value)}>
          {columns.map((column) => (
            <option key={column.slug} value={column.slug}>
              {column.slug === doneSlug ? `${column.label} (concluída)` : column.label}
            </option>
          ))}
        </select>
      </Field>

      {groups ? (
        <>
          <Field label="Workspace" id={`${ids}-workspace`}>
            <select
              id={`${ids}-workspace`}
              className="v3-input"
              value={String(selectedGroup)}
              onChange={(event) => onPlaceGroup(groups[Number(event.target.value)].projects[0].key)}
            >
              {groups.map((entry, index) => <option key={`${entry.label}-${index}`} value={String(index)}>{entry.label}</option>)}
            </select>
          </Field>
          <Field label="Projeto" id={`${ids}-project`}>
            <select id={`${ids}-project`} className="v3-input" value={values.projectKey} onChange={(event) => onChange('projeto', event.target.value)}>
              {(group ? group.projects : []).map((project) => <option key={project.key} value={project.key}>{project.label}</option>)}
            </select>
          </Field>
          {leaving && (
            <div className="v3-callout v3-callout--warn">
              <DialogIcon name="alert" />
              <p>Este card vai sair da lista atual (outro workspace ou projeto).</p>
            </div>
          )}
        </>
      ) : (
        <p className="v3-msg v3-msg--info">
          <DialogIcon name="info" size={16} />
          Este é um subcard; o lugar dele segue o do card principal.
        </p>
      )}

      <Field label="Tipo" id={`${ids}-tipo`}>
        <select id={`${ids}-tipo`} className="v3-input" value={values.tipo} onChange={(event) => onChange('tipo', event.target.value)}>
          <option value="">Sem tipo</option>
          {CARD_TIPOS.map((tipo) => <option key={tipo} value={tipo}>{CARD_TIPO_LABELS[tipo]}</option>)}
        </select>
      </Field>

      <Field label="Prioridade" id={`${ids}-prioridade`}>
        <select id={`${ids}-prioridade`} className="v3-input" value={values.prioridade} onChange={(event) => onChange('prioridade', event.target.value)}>
          <option value="">Sem prioridade</option>
          {[...CARD_PRIORIDADES].reverse().map((value) => <option key={value} value={value}>{CARD_PRIORIDADE_LABELS[value]}</option>)}
        </select>
      </Field>

      <Field label="Prazo" id={`${ids}-prazo`}>
        <div className="v3-card-due">
          <input id={`${ids}-prazo`} type="date" className="v3-input" value={values.prazo} onChange={(event) => onChange('prazo', event.target.value)} />
          {values.prazo && <Button variant="text" onClick={() => onChange('prazo', '')}>Limpar prazo</Button>}
        </div>
      </Field>

      {mode === 'edit' && card && (
        <div className="v3-field">
          <span className="v3-field__label">Criado em</span>
          <span className="v3-type-mono-sm v3-card-created">{formatCreatedAt(card.criado_em)}</span>
        </div>
      )}
    </>
  )
}
