// Focused deterministic checks for the Nonogram rules and the bundled starter puzzles.
// Run:  node src/arcade/games/nonograms/rules.check.ts   (non-zero exit on failure)
import { NONOGRAM_DEFS, NONOGRAM_PUZZLES } from '../../content/nonogramStarters.ts'
import { countSolutions } from './solver.ts'
import {
  clueOf, cluesFor, filledCount, newGame, parseSettings, parseState, satisfiesClues, setCell, toPuzzle, applyHint, validateDef,
  type PuzzleDef, type State,
} from './rules.ts'

let checks = 0
function check(name: string, ok: boolean): void {
  checks += 1
  if (!ok) throw new Error(`FAILED: ${name}`)
}
const must = <T>(r: { ok: true; state: T } | { ok: false; reason: string }): T => {
  if (!r.ok) throw new Error(`unexpected reject ${r.reason}`)
  return r.state
}

// 1. Bundled content: valid, unique ids, exactly one solution each (bounded solver).
check('at least 8 bundled puzzles', NONOGRAM_DEFS.length >= 8)
check('ids unique', new Set(NONOGRAM_DEFS.map((d) => d.id)).size === NONOGRAM_DEFS.length)
for (const def of NONOGRAM_DEFS) {
  check(`${def.id}: structurally valid`, validateDef(def) === null)
  const r = countSolutions(def)
  check(`${def.id}: search finished within budget`, r.exhausted)
  check(`${def.id}: exactly one solution`, r.solutions === 1)
}
// Negative controls: the validator and solver must actually discriminate.
const ambiguous: PuzzleDef = { id: 'amb', name: 'Ambiguous', rows: ['#.', '.#'] }
check('solver detects a non-unique puzzle', countSolutions(ambiguous).solutions === 2)
check('validator rejects bad defs', validateDef({ id: 'x', name: 'x', rows: ['##', '#'] }) !== null && validateDef({ id: 'x', name: 'x', rows: ['..', '..'] }) !== null && validateDef({ id: 'x', name: 'x', rows: ['#a', '..'] }) !== null)

// 2. Clues.
check('clueOf', JSON.stringify(clueOf([true, true, false, true, false])) === '[2,1]' && JSON.stringify(clueOf([false, false])) === '[0]' && JSON.stringify(clueOf([true, true, true])) === '[3]')
{
  const heart = NONOGRAM_PUZZLES.find((p) => p.id === 'heart')!
  const c = cluesFor(heart.size, heart.solution)
  check('heart row clues', JSON.stringify(c.rows) === '[[1,1],[5],[5],[3],[1]]')
  check('heart column clues', JSON.stringify(c.cols) === '[[2],[4],[4],[4],[2]]')
}

// 3. Play: fill/cross/clear, completion, hints, rejects.
const puzzle = toPuzzle({ id: 'p', name: 'p', rows: ['#.#', '.#.', '#.#'] })
{
  let s = newGame(puzzle)
  check('starts empty and unsolved', filledCount(s) === 0 && !s.solved)
  s = must(setCell(s, puzzle, 0, 'fill'))
  check('fill', s.cells[0] === 1)
  s = must(setCell(s, puzzle, 0, 'fill'))
  check('fill toggles off', s.cells[0] === 0)
  s = must(setCell(s, puzzle, 1, 'cross'))
  check('cross', s.cells[1] === 2)
  s = must(setCell(s, puzzle, 1, 'clear'))
  check('clear', s.cells[1] === 0)
  check('clear on empty is no-op reject', !setCell(s, puzzle, 1, 'clear').ok)
  check('out of range rejected', [-1, 9, 1.5].every((i) => !setCell(s, puzzle, i, 'fill').ok))
  const before = JSON.stringify(s)
  setCell(s, puzzle, 4, 'fill')
  check('setCell does not mutate its input', JSON.stringify(s) === before)
}
{
  let s = newGame(puzzle)
  for (const i of [0, 2, 4, 6, 8]) s = must(setCell(s, puzzle, i, 'fill'))
  check('exact completion solves', s.solved)
  check('no edits after solved', !setCell(s, puzzle, 1, 'cross').ok && !applyHint(s, puzzle).ok)
}
{
  let s = newGame(puzzle)
  for (const i of [0, 2, 4, 6]) s = must(setCell(s, puzzle, i, 'fill'))
  check('incomplete is not solved', !s.solved)
  s = must(setCell(s, puzzle, 1, 'fill')) // wrong cell filled
  check('wrong fill is not solved', !s.solved && !satisfiesClues(puzzle, s.cells))
}
{
  let s = newGame(puzzle)
  s = must(applyHint(s, puzzle))
  check('hint fixes first wrong cell and counts', s.cells[0] === 1 && s.hinted[0] && s.hintsUsed === 1)
  check('hinted cell is locked', !setCell(s, puzzle, 0, 'clear').ok)
  s = must(setCell(s, puzzle, 1, 'fill')) // wrong
  s = must(applyHint(s, puzzle))
  check('hint corrects a wrong fill with a cross, in reading order', s.cells[1] === 2 && s.hinted[1] && s.hintsUsed === 2)
  // Finish with hints only.
  let guard = 0
  while (!s.solved && guard++ < 20) s = must(applyHint(s, puzzle))
  check('hints alone can finish, hints are counted', s.solved && s.hintsUsed >= 3)
}

// 4. Save validation.
const settingsOk = parseSettings({ puzzleId: 'heart' }, NONOGRAM_PUZZLES)
check('settings parse', settingsOk?.puzzleId === 'heart' && parseSettings({ puzzleId: 'nope' }, NONOGRAM_PUZZLES) === null && parseSettings(null, NONOGRAM_PUZZLES) === null)
{
  let s = newGame(puzzle)
  s = must(applyHint(s, puzzle))
  s = must(setCell(s, puzzle, 4, 'fill'))
  const round = (x: State) => parseState(JSON.parse(JSON.stringify(x)), puzzle)
  check('state roundtrips', JSON.stringify(round(s)) === JSON.stringify(s))
  const bad = (mut: (o: Record<string, unknown>) => void) => {
    const o = JSON.parse(JSON.stringify(s)) as Record<string, unknown>
    mut(o)
    return parseState(o, puzzle) === null
  }
  check('rejects other puzzle id', bad((o) => { o.puzzleId = 'other' }))
  check('rejects wrong cell count', bad((o) => { (o.cells as unknown[]).pop() }))
  check('rejects bad cell value', bad((o) => { (o.cells as unknown[])[3] = 7 }))
  check('rejects hint count drift', bad((o) => { o.hintsUsed = 5 }))
  check('rejects hinted cell with wrong mark', bad((o) => { (o.cells as unknown[])[0] = 0 }))
  check('rejects false solved flag', bad((o) => { o.solved = true }))
  check('rejects junk', parseState(null, puzzle) === null && parseState('x', puzzle) === null && parseState([], puzzle) === null)
}

console.log(`nonograms rules.check: ${checks} checks passed`)
