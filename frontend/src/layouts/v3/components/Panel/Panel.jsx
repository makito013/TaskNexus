import './Panel.css'

// notice: undefined | tiq | fin — turns the card into a small inline notice.
// The dot of a notice is decoration; the text carries the meaning.
export default function Panel({ as: Tag = 'div', notice, className = '', children, ...rest }) {
  const classes = [
    'v3-panel',
    notice ? `v3-panel--notice-${notice}` : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <Tag className={classes} {...rest}>
      {notice && <span className="v3-panel__dot" aria-hidden="true" />}
      {notice ? <span className="v3-panel__text">{children}</span> : children}
    </Tag>
  )
}
