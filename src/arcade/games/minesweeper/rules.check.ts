// Focused deterministic checks for the Minesweeper rules.
// Run:  node src/arcade/games/minesweeper/rules.check.ts   (non-zero exit on failure)
import {
  BOARDS, adjacentMines, flagsPlaced, minesLeft, neighbours, newGame, parseSettings, parseState, reveal, toggleFlag,
  type Difficulty, type Random, type State,
} from './rules.ts'

let checks = 0
function check(name: string, ok: boolean): void {
  checks += 1
  if (!ok) throw new Error(`FAILED: ${name}`)
}

// Deterministic generator (mulberry32).
function seeded(seed: number): Random {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const must = <T>(r: { ok: true; state: T } | { ok: false; reason: string }): T => {
  if (!r.ok) throw new Error(`unexpected reject ${r.reason}`)
  return r.state
}

// 1. First reveal is always safe, for every cell, both boards, many seeds; mine count exact.
for (const d of ['starter', 'harder'] as Difficulty[]) {
  const n = BOARDS[d].size ** 2
  let ok = true
  for (let seed = 1; seed <= 40; seed++) {
    for (let cell = 0; cell < n; cell += 5) {
      const s = reveal(newGame({ difficulty: d }), cell, seeded(seed * 1000 + cell))
      if (!s.ok || s.state.status === 'lost' || !s.state.mines || s.state.mines[cell] || s.state.mines.filter(Boolean).length !== BOARDS[d].mines) ok = false
    }
  }
  check(`${d}: first reveal safe, exact mine count`, ok)
}
check('mines are not placed before the first reveal', newGame({ difficulty: 'starter' }).mines === null)

// 2. Counts and flood fill on a hand-built board.
const base = newGame({ difficulty: 'starter' })
function mineAt(...idx: number[]): boolean[] {
  const m = Array<boolean>(36).fill(false)
  for (const i of idx) m[i] = true
  return m
}
function withMines(m: boolean[]): State {
  return { ...base, mines: m, status: 'playing' }
}
{
  const s = withMines(mineAt(0, 35, 1, 2, 3, 4)) // keep exactly 6 mines
  check('adjacent count', adjacentMines(s, 6) === 2 && adjacentMines(s, 7) === 3)
  check('neighbours corner/edge/centre', neighbours(6, 0).length === 3 && neighbours(6, 1).length === 5 && neighbours(6, 7).length === 8)
}
{
  // Mines only in the top row cells 0..5; revealing bottom-right floods everything below row 1.
  const s = withMines(mineAt(0, 1, 2, 3, 4, 5))
  const r = must(reveal(s, 35, seeded(1)))
  const expectRevealed = (i: number) => i >= 6 // rows 1..5
  check('flood reveals zero regions and their number border', r.revealed.every((v, i) => v === expectRevealed(i)))
  check('flood stops at mines', r.revealed.slice(0, 6).every((v) => !v))
  check('status playing while safe cells remain? (all safe revealed => won)', r.status === 'won')
}
{
  // Flood does not reveal flagged cells.
  const s = { ...withMines(mineAt(0, 1, 2, 3, 4, 5)), flagged: Array<boolean>(36).fill(false) }
  s.flagged[20] = true
  const r = must(reveal(s, 35, seeded(1)))
  check('flood opens a wrongly flagged safe cell and clears its flag', r.revealed[20] && !r.flagged[20] && r.status === 'won')
  // Regression (review finding): flag, flood past it, unflag, save, resume must stay loadable.
  const colMines = withMines(mineAt(0, 6, 12, 18, 24, 30)) // mines down column 0
  const flaggedSafe = must(toggleFlag(colMines, 7)) // wrong flag on a numbered cell beside the zero region
  const flooded = must(reveal(flaggedSafe, 5, seeded(1)))
  check('flood past a wrong flag leaves a valid, resumable state', flooded.revealed[7] && !flooded.flagged[7] && parseState(JSON.parse(JSON.stringify(flooded)), { difficulty: 'starter' }) !== null)
  const unflagged = must(toggleFlag(must(toggleFlag(must(reveal(colMines, 7, seeded(1))), 0)), 0))
  check('flag then unflag a mine cell keeps the state valid', parseState(JSON.parse(JSON.stringify(unflagged)), { difficulty: 'starter' }) !== null)
}

// 3. Loss, win, flags, rejects.
{
  const s = withMines(mineAt(0, 1, 2, 3, 4, 5))
  const lost = must(reveal(s, 0, seeded(1)))
  check('revealing a mine loses', lost.status === 'lost' && lost.exploded === 0)
  check('no moves after loss', !reveal(lost, 20, seeded(1)).ok && !toggleFlag(lost, 20).ok)
}
{
  const s = withMines(mineAt(0, 1, 2, 3, 4, 5))
  const f = must(toggleFlag(s, 3))
  check('flag toggles and counts', flagsPlaced(f) === 1 && minesLeft(f) === 5 && minesLeft(must(toggleFlag(f, 3))) === 6)
  const r = reveal(f, 3, seeded(1))
  check('flagged cell cannot be revealed', !r.ok && r.reason === 'flagged')
  const rr = must(reveal(s, 6, seeded(1)))
  check('revealed cell cannot be revealed again or flagged', !reveal(rr, 6, seeded(1)).ok && !toggleFlag(rr, 6).ok)
  check('out-of-range rejected', [-1, 36, 0.5].every((i) => !reveal(s, i, seeded(1)).ok && !toggleFlag(s, i).ok))
}
check('flags allowed before the first reveal', must(toggleFlag(newGame({ difficulty: 'starter' }), 4)).flagged[4])
check('win requires every safe cell', (() => {
  const s = withMines(mineAt(0, 1, 2, 3, 4, 5))
  let st = s
  for (let i = 6; i < 36; i++) if (!st.revealed[i]) st = must(reveal(st, i, seeded(1)))
  return st.status === 'won'
})())
check('reveal does not mutate its input', (() => {
  const s = withMines(mineAt(0, 1, 2, 3, 4, 5)); const before = JSON.stringify(s)
  reveal(s, 35, seeded(1)); toggleFlag(s, 10)
  return JSON.stringify(s) === before
})())

// 4. Save validation.
const settings = { difficulty: 'starter' as Difficulty }
const playing = must(reveal(newGame(settings), 14, seeded(7)))
const roundtrip = (s: State) => parseState(JSON.parse(JSON.stringify(s)), settings)
check('settings parse', parseSettings({ difficulty: 'harder' })?.difficulty === 'harder' && parseSettings({ difficulty: 'x' }) === null && parseSettings(null) === null)
check('ready state roundtrips', roundtrip(newGame(settings)) !== null)
check('playing state roundtrips', playing.status === 'playing' && JSON.stringify(roundtrip(playing)) === JSON.stringify(playing))
const lostGame = (() => { const m = playing.mines!; const i = m.findIndex(Boolean); return must(reveal(playing, i, seeded(1))) })()
check('lost state roundtrips', lostGame.status === 'lost' && roundtrip(lostGame) !== null)
const bad = (mut: (o: Record<string, unknown>) => void) => {
  const o = JSON.parse(JSON.stringify(playing)) as Record<string, unknown>
  mut(o)
  return parseState(o, settings) === null
}
check('rejects wrong size/mine count', bad((o) => { o.size = 8 }) && bad((o) => { o.mineCount = 7 }))
check('rejects wrong array length', bad((o) => { (o.revealed as unknown[]).pop() }))
check('rejects mine count drift', bad((o) => { const m = o.mines as boolean[]; const i = m.findIndex((x) => !x); m[i] = true }))
check('rejects revealed mine while playing', bad((o) => { const m = o.mines as boolean[]; (o.revealed as boolean[])[m.findIndex(Boolean)] = true }))
check('rejects revealed+flagged cell', bad((o) => { const r = o.revealed as boolean[]; (o.flagged as boolean[])[r.findIndex(Boolean)] = true }))
check('rejects won with safe cells left', bad((o) => { o.status = 'won' }))
check('rejects broken flood closure', (() => {
  // Mines in the top row; rows 1-5 revealed except cell 20, which touches revealed zero cells.
  const mines = mineAt(0, 1, 2, 3, 4, 5)
  const revealed = mines.map((_, i) => i >= 6 && i !== 20)
  const o = { size: 6, mineCount: 6, mines, revealed, flagged: Array(36).fill(false), status: 'playing', exploded: null }
  const intact = { ...o, revealed: mines.map((_, i) => i >= 6 && i < 12) } // row 1 only: numbered cells, no zero cells => consistent
  return parseState(o, settings) === null && parseState(JSON.parse(JSON.stringify(intact)), settings) !== null
})())
check('rejects junk', parseState(null, settings) === null && parseState('x', settings) === null && parseState([], settings) === null)
check('rejects ready state with mines', (() => { const o = JSON.parse(JSON.stringify(newGame(settings))) as Record<string, unknown>; o.mines = Array(36).fill(false); return parseState(o, settings) === null })())

console.log(`minesweeper rules.check: ${checks} checks passed`)
