import './Chip.css'

// tone: neutral | state | id | badge
// accent (tone="state"): tiq | fin | kan | navi | danger | soon
// kind (tone="badge"): bug | hotfix | story
// The chip never carries meaning by colour alone: the text is always present and
// the dot of the state tone is decorative.
export default function Chip({ tone = 'neutral', accent, kind, className = '', children, ...rest }) {
  const classes = [
    'v3-chip',
    `v3-chip--${tone}`,
    tone === 'state' && accent ? `v3-chip--accent-${accent}` : '',
    tone === 'badge' && kind ? `v3-chip--kind-${kind}` : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <span className={classes} {...rest}>
      {tone === 'state' && <span className="v3-chip__dot" aria-hidden="true" />}
      {children}
    </span>
  )
}
