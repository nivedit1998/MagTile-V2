// Pixel art for the Virtual Pet: 16x16 bitmaps drawn in the screen's ink and paper colours.
// '#' ink, 'o' paper (eyes, mouth, spots), '.' transparent. Faces are drawn on top of the body by mood.
import type { Form, Mood, Stage } from './rules.ts'

export const GRID = 16

const EGG = [
  '................',
  '................',
  '.....######.....',
  '....########....',
  '...##########...',
  '...##########...',
  '..############..',
  '..############..',
  '..############..',
  '..############..',
  '...##########...',
  '...##########...',
  '....########....',
  '.....######.....',
  '................',
  '................',
]

const BABY = [
  '................', '................', '................', '................',
  '.....######.....',
  '....########....',
  '...##########...',
  '...##########...',
  '...##########...',
  '...##########...',
  '...##########...',
  '....########....',
  '...##.####.##...',
  '................', '................', '................',
]

const CHILD = [
  '................',
  '................',
  '..##........##..',
  '..###......###..',
  '..############..',
  '.##############.',
  '.##############.',
  '.##############.',
  '.##############.',
  '.##############.',
  '.##############.',
  '..############..',
  '..############..',
  '..###......###..',
  '..###......###..',
  '................',
]

const ADULT = [
  '................',
  '...##......##...',
  '...###....###...',
  '..############..',
  '.##############.',
  '.##############.',
  '.##############.',
  '################',
  '################',
  '################',
  '.##############.',
  '.##############.',
  '..############..',
  '..###......###..',
  '..###......###..',
  '................',
]

const SCHOLAR_TOP = ['.....######.....', '...##########...', '################']
const SPRITE_TOP = ['...#...##...#...', '..###.####.###..', '..############..']

interface Face { eyeL: number; eyeR: number; eyeY: number; mouthX: number; mouthY: number }

function bodyFor(stage: Stage, form: Form): { rows: string[]; face: Face } {
  if (stage === 'baby') return { rows: BABY, face: { eyeL: 5, eyeR: 10, eyeY: 7, mouthX: 6, mouthY: 10 } }
  if (stage === 'child') return { rows: CHILD, face: { eyeL: 4, eyeR: 11, eyeY: 6, mouthX: 6, mouthY: 9 } }
  const rows = ADULT.slice()
  if (form === 'scholar') SCHOLAR_TOP.forEach((r, i) => (rows[i] = r))
  if (form === 'sprite') SPRITE_TOP.forEach((r, i) => (rows[i] = r))
  return { rows, face: { eyeL: 4, eyeR: 11, eyeY: 5, mouthX: 6, mouthY: 8 } }
}

/** Returns 16 rows of 16 characters for the pet as it looks right now. */
export function sprite(stage: Stage, form: Form, mood: Mood, opts: { cracking?: boolean } = {}): string[] {
  const g = (stage === 'egg' ? EGG : bodyFor(stage, form).rows).map((r) => r.split(''))
  const set = (x: number, y: number, c: string) => {
    if (y >= 0 && y < GRID && x >= 0 && x < GRID && g[y][x] !== '.') g[y][x] = c
  }
  if (stage === 'egg') {
    for (const [x, y] of [[5, 5], [10, 7], [7, 10], [9, 4], [4, 9]]) set(x, y, 'o')
    if (opts.cracking) for (let x = 3; x <= 12; x++) set(x, x % 2 === 0 ? 8 : 9, 'o')
    return g.map((r) => r.join(''))
  }
  const { face } = bodyFor(stage, form)
  const closed = mood === 'sleeping' || mood === 'tired'
  const scholar = stage === 'adult' && form === 'scholar'
  for (const ex of [face.eyeL, face.eyeR]) {
    if (closed) {
      for (let x = ex - 1; x <= ex + 1; x++) set(x, face.eyeY + 1, 'o')
    } else if (scholar) {
      for (let y = face.eyeY - 1; y <= face.eyeY + 1; y++) for (let x = ex - 1; x <= ex + 1; x++) set(x, y, 'o')
      set(ex, face.eyeY, '#')
    } else {
      set(ex, face.eyeY, 'o')
      set(ex, face.eyeY + 1, 'o')
    }
  }
  const { mouthX: mx, mouthY: my } = face
  const row = (y: number, from: number, to: number) => { for (let x = from; x <= to; x++) set(x, y, 'o') }
  if (mood === 'happy') { set(mx, my, 'o'); set(mx + 3, my, 'o'); row(my + 1, mx + 1, mx + 2) }
  else if (mood === 'hungry') { row(my, mx + 1, mx + 2); row(my + 1, mx + 1, mx + 2) }
  else if (mood === 'sad') { row(my, mx + 1, mx + 2); set(mx, my + 1, 'o'); set(mx + 3, my + 1, 'o') }
  else if (mood === 'sleeping' || mood === 'tired') row(my, mx + 1, mx + 2)
  else row(my, mx, mx + 3)
  return g.map((r) => r.join(''))
}

/** Little glyph shown beside the pet for its mood. Text, not colour. */
export const MOOD_MARK: Record<Mood, string> = { sleeping: 'Z z z', tired: 'z', hungry: '!', sad: '…', happy: '♥', ok: '' }
