// Pure Minesweeper rules. No React, DOM, storage or network imports.
// Randomness is injected so tests are deterministic. Mines are placed after the first
// reveal and never on that cell. Generated boards are not guaranteed guess-free.

export type Difficulty = 'starter' | 'harder'
export type Status = 'ready' | 'playing' | 'won' | 'lost'

export const GAME_VERSION = 1
export const BOARDS: Record<Difficulty, { size: number; mines: number; label: string }> = {
  starter: { size: 6, mines: 6, label: '6 × 6 · 6 mines' },
  harder: { size: 8, mines: 10, label: '8 × 8 · 10 mines' },
}

export interface Settings {
  difficulty: Difficulty
}

export interface State {
  size: number
  mineCount: number
  /** null until the first reveal places them. */
  mines: boolean[] | null
  revealed: boolean[]
  flagged: boolean[]
  status: Status
  exploded: number | null
}

export type Result<T> = { ok: true; state: T } | { ok: false; reason: string }
export type Random = () => number // [0, 1)

export function newGame(settings: Settings): State {
  const { size, mines } = BOARDS[settings.difficulty]
  const n = size * size
  return {
    size,
    mineCount: mines,
    mines: null,
    revealed: Array<boolean>(n).fill(false),
    flagged: Array<boolean>(n).fill(false),
    status: 'ready',
    exploded: null,
  }
}

export function neighbours(size: number, i: number): number[] {
  const r = Math.floor(i / size)
  const c = i % size
  const out: number[] = []
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      const rr = r + dr
      const cc = c + dc
      if (rr >= 0 && rr < size && cc >= 0 && cc < size) out.push(rr * size + cc)
    }
  }
  return out
}

export function adjacentMines(state: State, i: number): number {
  if (!state.mines) return 0
  const mines = state.mines
  return neighbours(state.size, i).filter((j) => mines[j]).length
}

function placeMines(size: number, count: number, safe: number, random: Random): boolean[] {
  const n = size * size
  const candidates: number[] = []
  for (let i = 0; i < n; i++) if (i !== safe) candidates.push(i)
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)))
    ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }
  const mines = Array<boolean>(n).fill(false)
  for (const i of candidates.slice(0, count)) mines[i] = true
  return mines
}

const inRange = (state: State, i: number) => Number.isInteger(i) && i >= 0 && i < state.size * state.size
const isOver = (s: State) => s.status === 'won' || s.status === 'lost'

export function reveal(state: State, i: number, random: Random): Result<State> {
  if (isOver(state)) return { ok: false, reason: 'game-over' }
  if (!inRange(state, i)) return { ok: false, reason: 'out-of-range' }
  if (state.flagged[i]) return { ok: false, reason: 'flagged' }
  if (state.revealed[i]) return { ok: false, reason: 'already-revealed' }

  const mines = state.mines ?? placeMines(state.size, state.mineCount, i, random)
  const revealed = state.revealed.slice()
  const flagged = state.flagged.slice()
  const next: State = { ...state, mines, revealed, flagged, status: 'playing' }

  if (mines[i]) {
    revealed[i] = true
    return { ok: true, state: { ...next, status: 'lost', exploded: i } }
  }

  // Flood from zero-count cells. A flag on a safe cell the flood reaches is wrong, so it is
  // opened and its flag removed; this keeps "every neighbour of a revealed zero is revealed"
  // true, which save validation relies on.
  const stack = [i]
  revealed[i] = true
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (adjacentMines(next, cur) !== 0) continue
    for (const j of neighbours(state.size, cur)) {
      if (!revealed[j] && !mines[j]) {
        revealed[j] = true
        flagged[j] = false
        stack.push(j)
      }
    }
  }

  const safeLeft = revealed.some((r, idx) => !r && !mines[idx])
  return { ok: true, state: { ...next, status: safeLeft ? 'playing' : 'won' } }
}

export function toggleFlag(state: State, i: number): Result<State> {
  if (isOver(state)) return { ok: false, reason: 'game-over' }
  if (!inRange(state, i)) return { ok: false, reason: 'out-of-range' }
  if (state.revealed[i]) return { ok: false, reason: 'already-revealed' }
  const flagged = state.flagged.slice()
  flagged[i] = !flagged[i]
  return { ok: true, state: { ...state, flagged } }
}

export const flagsPlaced = (s: State) => s.flagged.filter(Boolean).length
export const minesLeft = (s: State) => s.mineCount - flagsPlaced(s)

// ---- Save validation ------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const boolArray = (v: unknown, n: number): v is boolean[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'boolean')

export function parseSettings(raw: unknown): Settings | null {
  if (!isObj(raw)) return null
  return raw.difficulty === 'starter' || raw.difficulty === 'harder' ? { difficulty: raw.difficulty } : null
}

export function parseState(raw: unknown, settings: Settings): State | null {
  if (!isObj(raw)) return null
  const { size, mines: mineCount } = BOARDS[settings.difficulty]
  const n = size * size
  const { mines, revealed, flagged, status, exploded } = raw
  if (raw.size !== size || raw.mineCount !== mineCount) return null
  if (!boolArray(revealed, n) || !boolArray(flagged, n)) return null
  if (status !== 'ready' && status !== 'playing' && status !== 'won' && status !== 'lost') return null
  if (revealed.some((r, i) => r && flagged[i])) return null

  if (status === 'ready') {
    if (mines !== null || exploded !== null || revealed.some(Boolean)) return null
    return { size, mineCount, mines: null, revealed, flagged, status, exploded: null }
  }

  if (!boolArray(mines, n) || mines.filter(Boolean).length !== mineCount) return null
  const state: State = { size, mineCount, mines, revealed, flagged, status, exploded: exploded === null ? null : (exploded as number) }

  const revealedMines = revealed.map((r, i) => (r && mines[i] ? i : -1)).filter((i) => i >= 0)
  if (status === 'lost') {
    if (!Number.isInteger(exploded) || revealedMines.length !== 1 || revealedMines[0] !== exploded) return null
  } else {
    if (exploded !== null || revealedMines.length !== 0) return null
    const safeLeft = revealed.some((r, i) => !r && !mines[i])
    if (status === 'won' && safeLeft) return null
    if (status === 'playing' && (!safeLeft || !revealed.some(Boolean))) return null
  }

  // Flood closure: a revealed zero-count cell has no unrevealed, unflagged safe neighbour.
  for (let i = 0; i < n; i++) {
    if (revealed[i] && !mines[i] && adjacentMines(state, i) === 0) {
      for (const j of neighbours(size, i)) if (!revealed[j]) return null
    }
  }
  return state
}
