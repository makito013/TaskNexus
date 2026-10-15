// Static geometry of the five pet silhouettes (viewBox 0 0 48 48), copied from the
// design-system sheet Pets.dc.html. Colours are CSS custom properties only (tokens),
// never hex, so the pets follow the theme and the generated tokens.
//
// An accessory is drawn BEFORE the body (the body covers its base).

export const PET_IDS = ['bit', 'tiq', 'fin', 'kan', 'navi']

export const PET_NAMES = { bit: 'Bit', tiq: 'Tiq', fin: 'Fin', kan: 'Kan', navi: 'Navi' }

const DOME_BODY = 'M8 29a16 16 0 0 1 32 0v5a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6z'

const color = (name) => `var(--v3-${name})`

export const PET_SHAPES = {
  bit: {
    body: DOME_BODY,
    visor: { x: 12, width: 24 },
    accessory: [
      { tag: 'path', props: { d: 'M24 13V6', stroke: color('bit'), strokeWidth: 2, strokeLinecap: 'round', fill: 'none' } },
      { tag: 'circle', props: { cx: 24, cy: 4.5, r: 2.6, fill: color('bit') } },
    ],
  },
  tiq: {
    body: 'M9 14h30a4 4 0 0 1 4 4v16a6 6 0 0 1-6 6H11a6 6 0 0 1-6-6V18a4 4 0 0 1 4-4z',
    visor: { x: 12, width: 24 },
    accessory: [
      { tag: 'rect', props: { x: 18, y: 8, width: 12, height: 9, rx: 2.5, fill: color('tiq-deep') } },
      { tag: 'rect', props: { x: 21, y: 5, width: 6, height: 5, rx: 1.5, fill: color('tiq') } },
    ],
  },
  fin: {
    body: 'M24 10a17 17 0 1 1 0 34a17 17 0 1 1 0-34z',
    visor: { x: 12, width: 24 },
    accessory: [
      { tag: 'rect', props: { x: 18.5, y: 12.5, width: 11, height: 3, rx: 1.5, fill: color('fin-deep') } },
    ],
  },
  kan: {
    body: 'M6 17h36a4 4 0 0 1 4 4v13a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6V21a4 4 0 0 1 4-4z',
    visor: { x: 10, width: 28 },
    accessory: [
      { tag: 'rect', props: { x: 9, y: 9, width: 8, height: 9, rx: 2, fill: color('kan-deep') } },
      { tag: 'rect', props: { x: 20, y: 6, width: 8, height: 12, rx: 2, fill: color('kan-deep') } },
      { tag: 'rect', props: { x: 31, y: 11, width: 8, height: 7, rx: 2, fill: color('kan-deep') } },
    ],
  },
  navi: {
    body: DOME_BODY,
    visor: { x: 12, width: 24 },
    accessory: [
      { tag: 'path', props: { d: 'M24 13V9', stroke: color('navi'), strokeWidth: 2, strokeLinecap: 'round', fill: 'none' } },
      { tag: 'circle', props: { cx: 24, cy: 5.5, r: 3.5, fill: 'none', stroke: color('navi'), strokeWidth: 2 } },
      { tag: 'circle', props: { cx: 24, cy: 5.5, r: 1.2, fill: color('navi') } },
    ],
  },
}

export const SIZE_PIXELS = { front: 60, side: 40, nav: 34 }

// Idle timing of the side pets, so the colleagues in the island do not breathe in
// sync (seconds: bob / blink). The front pet uses 3 / 4 (the pet-bob / pet-blink tokens).
export const SIDE_IDLE_TIMING = {
  bit: { bob: 3, blink: 4 },
  tiq: { bob: 3.4, blink: 4.6 },
  fin: { bob: 2.8, blink: 3.7 },
  kan: { bob: 3.1, blink: 5.1 },
  navi: { bob: 3.6, blink: 4.2 },
}
export const DEFAULT_IDLE_TIMING = { bob: 3, blink: 4 }
