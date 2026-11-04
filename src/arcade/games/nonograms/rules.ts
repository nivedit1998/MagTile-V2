// Pure Nonogram rules. No React, DOM, storage or network imports.

export type CellMark = 0 | 1 | 2 // empty, filled, crossed
export type Mode = 'fill' | 'cross' | 'clear'

export const GAME_VERSION = 1

/** A bundled puzzle: `rows` use '#' for filled and '.' for empty. */
export interface PuzzleDef {
  id: string
  name: string
  rows: readonly string[]
}

export interface Puzzle {
  id: string
  name: string
  size: number
  solution: boolean[] // row-major
}

export interface Settings {
  puzzleId: string
}

export interface State {
  puzzleId: string
  cells: CellMark[]
  /** Cells fixed by a hint; they cannot be changed afterwards. */
  hinted: boolean[]
  hintsUsed: number
  solved: boolean
}

export type Result<T> = { ok: true; state: T } | { ok: false; reason: string }

/** Structural validation of a bundled puzzle definition. Returns an error message or null. */
export function validateDef(def: PuzzleDef): string | null {
  const n = def.rows.length
  if (!def.id || !def.name) return 'missing id or name'
  if (n < 2 || n > 10) return 'size out of range'
  if (!def.rows.every((r) => r.length === n && /^[#.]+$/.test(r))) return 'rows must be square and use only # and .'
  if (!def.rows.some((r) => r.includes('#'))) return 'puzzle is empty'
  return null
}

export function toPuzzle(def: PuzzleDef): Puzzle {
  const err = validateDef(def)
  if (err) throw new Error(`Invalid puzzle ${def.id}: ${err}`)
  return { id: def.id, name: def.name, size: def.rows.length, solution: def.rows.flatMap((r) => [...r].map((c) => c === '#')) }
}

/** Run lengths of filled cells; an empty line is [0]. */
export function clueOf(line: readonly boolean[]): number[] {
  const out: number[] = []
  let run = 0
  for (const v of line) {
    if (v) run += 1
    else if (run > 0) {
      out.push(run)
      run = 0
    }
  }
  if (run > 0) out.push(run)
  return out.length === 0 ? [0] : out
}

export function cluesFor(size: number, filled: readonly boolean[]): { rows: number[][]; cols: number[][] } {
  const rows: number[][] = []
  const cols: number[][] = []
  for (let i = 0; i < size; i++) {
    rows.push(clueOf(filled.slice(i * size, i * size + size)))
    cols.push(clueOf(Array.from({ length: size }, (_, r) => filled[r * size + i])))
  }
  return { rows, cols }
}

const sameClue = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i])

/** True when the filled cells satisfy every row and column clue. */
export function satisfiesClues(puzzle: Puzzle, cells: readonly CellMark[]): boolean {
  const want = cluesFor(puzzle.size, puzzle.solution)
  const got = cluesFor(puzzle.size, cells.map((c) => c === 1))
  return want.rows.every((r, i) => sameClue(r, got.rows[i])) && want.cols.every((c, i) => sameClue(c, got.cols[i]))
}

export function newGame(puzzle: Puzzle): State {
  const n = puzzle.size * puzzle.size
  return { puzzleId: puzzle.id, cells: Array<CellMark>(n).fill(0), hinted: Array<boolean>(n).fill(false), hintsUsed: 0, solved: false }
}

export function setCell(state: State, puzzle: Puzzle, i: number, mode: Mode): Result<State> {
  if (state.solved) return { ok: false, reason: 'solved' }
  if (!Number.isInteger(i) || i < 0 || i >= state.cells.length) return { ok: false, reason: 'out-of-range' }
  if (state.hinted[i]) return { ok: false, reason: 'hinted' }
  const cur = state.cells[i]
  const next: CellMark = mode === 'clear' ? 0 : mode === 'fill' ? (cur === 1 ? 0 : 1) : cur === 2 ? 0 : 2
  if (next === cur) return { ok: false, reason: 'no-change' }
  const cells = state.cells.slice()
  cells[i] = next
  return { ok: true, state: { ...state, cells, solved: satisfiesClues(puzzle, cells) } }
}

/** Fixes the first wrong cell to its correct value and records that a hint was used. */
export function applyHint(state: State, puzzle: Puzzle): Result<State> {
  if (state.solved) return { ok: false, reason: 'solved' }
  const i = puzzle.solution.findIndex((filled, idx) => (filled && state.cells[idx] !== 1) || (!filled && state.cells[idx] === 1))
  if (i < 0) return { ok: false, reason: 'nothing-to-hint' }
  const cells = state.cells.slice()
  const hinted = state.hinted.slice()
  cells[i] = puzzle.solution[i] ? 1 : 2
  hinted[i] = true
  return { ok: true, state: { ...state, cells, hinted, hintsUsed: state.hintsUsed + 1, solved: satisfiesClues(puzzle, cells) } }
}

export const filledCount = (s: State) => s.cells.filter((c) => c === 1).length

// ---- Save validation ------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseSettings(raw: unknown, puzzles: readonly Puzzle[]): Settings | null {
  if (!isObj(raw) || typeof raw.puzzleId !== 'string') return null
  return puzzles.some((p) => p.id === raw.puzzleId) ? { puzzleId: raw.puzzleId } : null
}

export function parseState(raw: unknown, puzzle: Puzzle): State | null {
  if (!isObj(raw) || raw.puzzleId !== puzzle.id) return null
  const n = puzzle.size * puzzle.size
  const { cells, hinted, hintsUsed, solved } = raw
  if (!Array.isArray(cells) || cells.length !== n || !cells.every((c) => c === 0 || c === 1 || c === 2)) return null
  if (!Array.isArray(hinted) || hinted.length !== n || !hinted.every((h) => typeof h === 'boolean')) return null
  if (typeof hintsUsed !== 'number' || !Number.isInteger(hintsUsed) || hintsUsed < 0) return null
  if (typeof solved !== 'boolean') return null
  const marks = cells as CellMark[]
  const flags = hinted as boolean[]
  if (flags.filter(Boolean).length !== hintsUsed) return null
  if (!flags.every((h, i) => !h || marks[i] === (puzzle.solution[i] ? 1 : 2))) return null
  if (solved !== satisfiesClues(puzzle, marks)) return null
  return { puzzleId: puzzle.id, cells: marks, hinted: flags, hintsUsed, solved }
}
