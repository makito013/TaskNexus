import './Button.css'

const DEFAULT_MODULE = 'tiq'

// variant: primary | secondary | text | module | island
// size: sm | md | lg
// module: bit | tiq | fin | kan | navi (only meaningful for variant="module";
//         variant="module" without it falls back to tiq so the text never vanishes)
export default function Button({
  variant = 'secondary',
  size = 'md',
  module: moduleProp,
  type = 'button',
  className = '',
  children,
  ...buttonProps
}) {
  const module = variant === 'module' ? moduleProp || DEFAULT_MODULE : moduleProp
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
