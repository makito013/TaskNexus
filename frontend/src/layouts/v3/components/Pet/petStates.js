// Per-state motion data of the pet, in the units SMIL needs (seconds, not CSS
// custom properties: <animate> cannot read var()). The durations mirror the
// movement tokens (pet-bob 3000ms, pet-talk 600ms, pet-alert 1200ms).

export const PET_STATES = ['idle', 'listening', 'talking', 'thinking', 'alert', 'sleeping']

export const STATE_LABELS = {
  idle: 'ocioso',
  listening: 'ouvindo',
  talking: 'falando',
  thinking: 'pensando',
  alert: 'em alerta',
  sleeping: 'dormindo',
}

const BOB_KEY_TIMES = '0;0.5;1'

// Body bob (translate), floor shadow radius (rx) and the shadow key times.
export const STATE_MOTION = {
  idle: {
    bob: { values: '0 0;0 -2;0 0', keyTimes: BOB_KEY_TIMES, dur: 3 },
    shadow: { values: '11;10;11', dur: 3 },
  },
  listening: {
    bob: { values: '0 0;0 -1;0 0', keyTimes: BOB_KEY_TIMES, dur: 1.4 },
    shadow: { values: '11;10.5;11', dur: 1.4 },
  },
  talking: {
    bob: { values: '0 0;0 -1.5;0 0', keyTimes: BOB_KEY_TIMES, dur: 0.6 },
    shadow: { values: '11;10.5;11', dur: 0.6 },
  },
  thinking: {
    bob: { values: '0 0;0 -1;0 0', keyTimes: BOB_KEY_TIMES, dur: 2.6 },
    shadow: { values: '11;10.5;11', dur: 2.6 },
    tilt: { values: '0 24 30;-5 24 30;0 24 30;5 24 30;0 24 30', dur: 5.2 },
  },
  alert: {
    // 6px jump during the first 30% of the cycle, then rest.
    bob: { values: '0 0;0 -6;0 0;0 0', keyTimes: '0;0.15;0.3;1', dur: 1.2 },
    shadow: { values: '11;8;11;11', keyTimes: '0;0.15;0.3;1', dur: 1.2 },
    ring: { radius: '17;24', opacity: '0.9;0', dur: 1.2 },
  },
  sleeping: {
    bob: { values: '0 1;0 -0.5;0 1', keyTimes: BOB_KEY_TIMES, dur: 5 },
    shadow: { values: '11;10.5;11', dur: 5 },
  },
}

// Shared by the LED shapes of every state.
export const LED_FILL = 'var(--v3-pet-led)'

// Static LED shapes (also the reduced-motion and nav look) and the animated
// values of the shapes that animate. Shapes are described as data; Pet.jsx
// decides whether to attach the <animate> children.
export const LED_SHAPES = {
  idle: {
    bar: { x: 18, y: 24, width: 12, height: 3, rx: 1.5 },
    blink: {
      height: '3;3;0.6;3',
      y: '24;24;25.2;24',
      keyTimes: '0;0.88;0.94;1',
    },
  },
  listening: {
    bars: [
      { x: 17, y: 23.5, width: 3, height: 4, rx: 1.5, animate: { height: '4;8;4', y: '23.5;21.5;23.5', dur: 0.9 } },
      { x: 22.5, y: 21.5, width: 3, height: 8, rx: 1.5, animate: { height: '8;3;8', y: '21.5;24;21.5', dur: 0.7 } },
      { x: 28, y: 23, width: 3, height: 5, rx: 1.5, animate: { height: '5;8;5', y: '23;21.5;23', dur: 1.1 } },
    ],
  },
  talking: {
    smile: {
      d: 'M18 24.5q6 4.5 12 0',
      animatedD: 'M18 24.5q6 4.5 12 0;M18 23.5q6 7 12 0;M18 24.5q6 4.5 12 0',
      dur: 0.6,
    },
  },
  thinking: {
    dot: { cx: 24, cy: 25.5, r: 2.3 },
    animatedCx: { values: '19;29;29;19;19', keyTimes: '0;0.3;0.5;0.8;1', dur: 2.6 },
  },
  alert: {
    bars: [
      { x: 19, y: 22, width: 3, height: 7, rx: 1.5 },
      { x: 26, y: 22, width: 3, height: 7, rx: 1.5 },
    ],
  },
  sleeping: {
    bar: { x: 18, y: 25, width: 12, height: 1.6, rx: 0.8, opacity: 0.7 },
    zzz: [
      { cx: 39, cy: 16, r: 1.6, cyValues: '17;9', begin: undefined },
      { cx: 43, cy: 12, r: 1.1, cyValues: '13;5', begin: '1.2s' },
    ],
    dur: 2.4,
  },
}
