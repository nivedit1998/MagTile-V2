// Development-time solver used by rules.check.ts to prove each bundled puzzle has exactly
// one solution. Not imported by the app, so it is never bundled or run on a device.

import { type PuzzleDef, cluesFor, toPuzzle } from './rules.ts'

/** Every way to place `clue` in a line of `size` cells. */
function lineCandidates(clue: readonly number[], size: number): boolean[][] {
  const out: boolean[][] = []
  const runs = clue[0] === 0 ? [] : clue
  const place = (idx: number, pos: number, line: boolean[]) => {
    if (idx === runs.length) {
      out.push([...line, ...Array<boolean>(size - line.length).fill(false)])
      return
    }
    const rest = runs.slice(idx + 1).reduce((a, b) => a + b + 1, 0)
    for (let start = pos; start + runs[idx] + rest <= size; start++) {
      const next = [...line, ...Array<boolean>(start - line.length).fill(false), ...Array<boolean>(runs[idx]).fill(true)]
      if (idx < runs.length - 1) next.push(false)
      place(idx + 1, next.length, next)
    }
  }
  place(0, 0, [])
  return out
}

export interface SolveResult {
  solutions: number // capped at `limit`
  exhausted: boolean // false if the search budget ran out before finishing
}

/** Counts solutions (up to `limit`) of the puzzle's clues, bounded by `budget` row combinations. */
export function countSolutions(def: PuzzleDef, limit = 2, budget = 5_000_000): SolveResult {
  const puzzle = toPuzzle(def)
  const n = puzzle.size
  const { rows, cols } = cluesFor(n, puzzle.solution)
  const rowCands = rows.map((r) => lineCandidates(r, n))
  const colCands = cols.map((c) => lineCandidates(c, n))
  let found = 0
  let visited = 0
  let truncated = false

  // Column prefix feasibility: some candidate of each column starts with the prefix built so far.
  const prefixOk = (grid: boolean[][], depth: number): boolean => {
    for (let c = 0; c < n; c++) {
      const ok = colCands[c].some((cand) => {
        for (let r = 0; r < depth; r++) if (cand[r] !== grid[r][c]) return false
        return true
      })
      if (!ok) return false
    }
    return true
  }

  const grid: boolean[][] = []
  const dfs = (r: number): void => {
    if (found >= limit || truncated) return
    if (r === n) {
      found += 1
      return
    }
    for (const cand of rowCands[r]) {
      if (++visited > budget) {
        truncated = true
        return
      }
      grid[r] = cand
      if (prefixOk(grid, r + 1)) dfs(r + 1)
      if (found >= limit || truncated) return
    }
    grid.length = r
  }
  dfs(0)
  return { solutions: found, exhausted: !truncated }
}
