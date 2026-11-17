import '../../../components/ApprovalCard/ApprovalCard.css'

// Pieces shared by the question and plan cards. Both reuse the look of the generic ApprovalCard
// (fin colours, 14 px radius, the resolved one-liner), so the three kinds read as one family.

export const SHARED_RESOLVED = {
  elsewhere: 'Decidido em outro dispositivo.',
  expired: 'Expirou ao reabrir a conversa.',
  cancelled: 'Pedido cancelado.',
}

export function CardHead({ agentName, children }) {
  return (
    <div className="v3-approval__head">
      <span className="v3-approval__dot" aria-hidden="true" />
      <b className="v3-approval__who">{agentName}</b>
      <span className="v3-approval__quer">{children}</span>
    </div>
  )
}

// The one quiet line a decided card collapses to. `extra` is a second line (a comment).
export function ResolvedRow({ status, children, extra = null }) {
  const elsewhere = status === 'elsewhere'
  const classes = ['v3-approval', 'v3-approval--resolved', elsewhere ? 'v3-approval--elsewhere' : ''].filter(Boolean).join(' ')
  return (
    <div className={classes} role="status" data-status={status}>
      <span className="v3-approval__dot v3-approval__dot--quiet" aria-hidden="true" />
      <div className="v3-approval__resolved-text">
        <span>{children}</span>
        {extra ? <span className="v3-approval__reason-line">{extra}</span> : null}
      </div>
    </div>
  )
}

export function oneLine(text, max = 80) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
