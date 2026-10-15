import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js'
import {
  DEFAULT_IDLE_TIMING,
  PET_NAMES,
  PET_SHAPES,
  SIDE_IDLE_TIMING,
  SIZE_PIXELS,
} from './petShapes.js'
import { LED_FILL, LED_SHAPES, STATE_LABELS, STATE_MOTION } from './petStates.js'
import './Pet.css'

const REPEAT = 'indefinite'
const seconds = (value) => `${value}s`

function Led({ state, animated }) {
  const shapes = LED_SHAPES[state]

  if (state === 'idle') {
    const { bar, blink } = shapes
    return (
      <rect {...bar} fill={LED_FILL}>
        {animated && (
          <>
            <animate attributeName="height" values={blink.height} keyTimes={blink.keyTimes} dur={animated.blink} repeatCount={REPEAT} />
            <animate attributeName="y" values={blink.y} keyTimes={blink.keyTimes} dur={animated.blink} repeatCount={REPEAT} />
          </>
        )}
      </rect>
    )
  }

  if (state === 'listening') {
    return shapes.bars.map(({ animate, ...bar }) => (
      <rect key={bar.x} {...bar} fill={LED_FILL}>
        {animated && (
          <>
            <animate attributeName="height" values={animate.height} dur={seconds(animate.dur)} repeatCount={REPEAT} />
            <animate attributeName="y" values={animate.y} dur={seconds(animate.dur)} repeatCount={REPEAT} />
          </>
        )}
      </rect>
    ))
  }

  if (state === 'talking') {
    const { smile } = shapes
    return (
      <path d={smile.d} fill="none" stroke={LED_FILL} strokeWidth="2.4" strokeLinecap="round">
        {animated && (
          <animate attributeName="d" values={smile.animatedD} dur={seconds(smile.dur)} repeatCount={REPEAT} />
        )}
      </path>
    )
  }

  if (state === 'thinking') {
    const { dot, animatedCx } = shapes
    return (
      <circle {...dot} fill={LED_FILL}>
        {animated && (
          <animate attributeName="cx" values={animatedCx.values} keyTimes={animatedCx.keyTimes} dur={seconds(animatedCx.dur)} repeatCount={REPEAT} />
        )}
      </circle>
    )
  }

  if (state === 'alert') {
    return shapes.bars.map((bar) => <rect key={bar.x} {...bar} fill={LED_FILL} />)
  }

  return <rect {...shapes.bar} fill={LED_FILL} />
}

function Zzz({ pet, shapes }) {
  return shapes.zzz.map(({ cyValues, begin, ...circle }) => (
    <circle key={circle.cx} {...circle} fill={`var(--v3-${pet})`}>
      <animate attributeName="cy" values={cyValues} dur={seconds(shapes.dur)} begin={begin} repeatCount={REPEAT} />
      <animate attributeName="opacity" values="0;0.9;0" dur={seconds(shapes.dur)} begin={begin} repeatCount={REPEAT} />
    </circle>
  ))
}

// The character of a module. Pure SVG with SMIL animations (SMIL cannot be switched
// off from CSS, so with prefers-reduced-motion NO <animate*> element is rendered).
// size="nav" (the module rail) is always static and has no floor shadow.
//   pet:   bit | tiq | fin | kan | navi
//   state: idle | listening | talking | thinking | alert | sleeping
//   size:  front | side | nav | <number of px>
export default function Pet({ pet, state = 'idle', size = 'front', decorative = false }) {
  const reducedMotion = usePrefersReducedMotion()
  const shape = PET_SHAPES[pet]
  const motion = STATE_MOTION[state]
  const pixels = typeof size === 'number' ? size : SIZE_PIXELS[size]
  const isNav = size === 'nav'
  const animated = !reducedMotion && !isNav

  const idleTiming = size === 'side' ? SIDE_IDLE_TIMING[pet] : DEFAULT_IDLE_TIMING
  const bobDur = state === 'idle' ? idleTiming.bob : motion.bob.dur
  const blinkDur = seconds(idleTiming.blink)
  const ledAnimated = animated && (state === 'idle' ? { blink: blinkDur } : true)

  const accessibility = decorative
    ? { 'aria-hidden': 'true' }
    : { role: 'img', 'aria-label': `${PET_NAMES[pet]} ${STATE_LABELS[state]}` }
  const shadowOpacity = typeof size === 'number' ? 0.28 : 0.35

  return (
    <svg
      className={`v3-pet v3-pet--${pet} v3-pet--${state}`}
      viewBox="0 0 48 48"
      width={pixels}
      height={pixels}
      {...accessibility}
    >
      {!isNav && (
        <ellipse cx="24" cy="45.5" rx="11" ry="1.8" fill={`var(--v3-${pet})`} opacity={shadowOpacity}>
          {animated && (
            <animate
              attributeName="rx"
              values={motion.shadow.values}
              keyTimes={motion.shadow.keyTimes}
              dur={seconds(state === 'idle' ? idleTiming.bob : motion.shadow.dur)}
              repeatCount={REPEAT}
            />
          )}
        </ellipse>
      )}

      {animated && state === 'alert' && (
        <circle cx="24" cy="28" r="18" fill="none" stroke="var(--v3-fin)" strokeWidth="2">
          <animate attributeName="r" values={motion.ring.radius} dur={seconds(motion.ring.dur)} repeatCount={REPEAT} />
          <animate attributeName="opacity" values={motion.ring.opacity} dur={seconds(motion.ring.dur)} repeatCount={REPEAT} />
        </circle>
      )}

      <g className="v3-pet__bob">
        {animated && (
          <animateTransform
            attributeName="transform"
            type="translate"
            values={motion.bob.values}
            keyTimes={motion.bob.keyTimes}
            dur={seconds(bobDur)}
            repeatCount={REPEAT}
          />
        )}
        <g className="v3-pet__tilt">
          {animated && state === 'thinking' && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              values={motion.tilt.values}
              dur={seconds(motion.tilt.dur)}
              repeatCount={REPEAT}
            />
          )}
          {shape.accessory.map(({ tag: Tag, props }, index) => (
            <Tag key={index} {...props} />
          ))}
          <path d={shape.body} fill={`var(--v3-${pet})`} />
          <rect x={shape.visor.x} y="20" width={shape.visor.width} height="11" rx="5.5" fill="var(--v3-pet-visor)" />
          <g key={state} className={animated ? 'v3-pet__led v3-pet__led--fade' : 'v3-pet__led'}>
            <Led state={state} animated={ledAnimated} />
          </g>
        </g>
      </g>

      {animated && state === 'sleeping' && <Zzz pet={pet} shapes={LED_SHAPES.sleeping} />}
    </svg>
  )
}
