import './Button.css'

// variant: primary | secondary | text | module | island
// size: sm | md | lg
// module: bit | tiq | fin | kan | navi (only meaningful for variant="module")
export default function Button({
  variant = 'secondary',
  size = 'md',
  module,
  type = 'button',
  className = '',
  children,
  ...buttonProps
}) {
  const classes = [
    'v3-button',
    `v3-button--${variant}`,
    `v3-button--${size}`,
    module ? `v3-button--module-${module}` : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <button type={type} className={classes} {...buttonProps}>
      {children}
    </button>
  )
}
