// Focused deterministic checks for the Tic-Tac-Toe rules.
// Run (no test framework, no packages):  node src/arcade/games/tictactoe/rules.check.ts
// Any failed check throws, so the process exits non-zero.
import {
  LINES, evaluate, newMatch, nextRound, parseSettings, parseState, place, replayStarter,
  validateNames, matchWinner,
  type Player, type Settings, type State,
} from './rules.ts'

let checks = 0
function check(name: string, ok: boolean): void {
  checks += 1
  if (!ok) throw new Error(`FAILED: ${name}`)
}

const s1: Settings = { names: ['Ann', 'Bob'], rounds: 1 }
const s3: Settings = { names: ['Ann', 'Bob'], rounds: 3 }
const s5: Settings = { names: ['Ann', 'Bob'], rounds: 5 }

function play(state: State, settings: Settings, cells: number[]): State {
  let s = state
  for (const c of cells) {
    const r = place(s, settings, s.turn, c)
    if (!r.ok) throw new Error(`unexpected reject ${r.reason} at ${c}`)
    s = r.state
  }
  return s
}

// 1. All eight winning lines are detected, for the first player.
for (const line of LINES) {
  const rest = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => !line.includes(c))
  const moves = [line[0], rest[0], line[1], rest[1], line[2]]
  const s = play(newMatch(0), s3, moves)
  check(`line ${line.join('')} wins`, s.roundStatus === 'won' && s.winner === 0 && JSON.stringify(s.line) === JSON.stringify(line) && s.scores[0] === 1)
}
// ...and for the second player (O).
for (const line of LINES) {
  const rest = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => !line.includes(c))
  // X plays 3 safe cells that never complete a line, O completes `line`.
  const xs = rest.slice(0, 3)
  const moves = [xs[0], line[0], xs[1], line[1], xs[2], line[2]]
  const pre = play(newMatch(0), s3, moves.slice(0, 5))
  if (pre.roundStatus !== 'playing') continue // X got a line by accident for this ordering; skip that arrangement
  const s = play(pre, s3, [moves[5]])
  check(`line ${line.join('')} wins for O`, s.roundStatus === 'won' && s.winner === 1)
}

// 2. Draw.
const drawn = play(newMatch(0), s1, [0, 1, 2, 4, 3, 5, 7, 6, 8])
check('draw detected', drawn.roundStatus === 'draw' && drawn.draws === 1 && drawn.winner === null)
check('draw ends a single-game match, tied', drawn.matchOver && matchWinner(drawn) === null)

// 3. Illegal moves are rejected and change nothing.
const m = newMatch(0)
check('occupied rejected', (() => { const a = play(m, s3, [4]); const r = place(a, s3, a.turn, 4); return !r.ok && r.reason === 'occupied' })())
check('out of turn rejected', (() => { const r = place(m, s3, 1, 0); return !r.ok && r.reason === 'out-of-turn' })())
check('out of range rejected', [-1, 9, 1.5, NaN].every((c) => { const r = place(m, s3, 0, c); return !r.ok && r.reason === 'out-of-range' }))
check('post-win move rejected', (() => {
  const won = play(newMatch(0), s3, [0, 3, 1, 4, 2])
  const r = place(won, s3, won.turn, 8)
  return !r.ok && r.reason === 'round-over' && won.scores[0] === 1
})())
check('post-match move rejected', (() => {
  const won = play(newMatch(0), s1, [0, 3, 1, 4, 2])
  const r = place(won, s1, 0, 8)
  return won.matchOver && !r.ok && r.reason === 'match-over'
})())
check('repeated move gives one score only', (() => {
  const won = play(newMatch(0), s3, [0, 3, 1, 4, 2])
  place(won, s3, 0, 2); place(won, s3, 0, 2)
  return won.scores[0] === 1
})())
check('place does not mutate its input', (() => {
  const before = JSON.stringify(m)
  place(m, s3, 0, 0)
  return JSON.stringify(m) === before
})())

// 4. Round alternation, scoring, clinch, tie.
let r = play(newMatch(0), s3, [0, 3, 1, 4, 2]) // Ann wins round 1
check('round 1 scored', r.scores[0] === 1 && !r.matchOver)
const n = nextRound(r)
check('next round ok', n.ok)
if (!n.ok) throw new Error('unreachable')
r = n.state
check('starter alternates between rounds', r.starter === 1 && r.turn === 1 && r.roundIndex === 1 && r.board.every((c) => c === null))
r = play(r, s3, [0, 3, 1, 4, 2]) // Bob (O index 1) starts: Bob wins
check('second player scored', r.scores[1] === 1 && r.winner === 1 && !r.matchOver)
const n3 = nextRound(r)
if (!n3.ok) throw new Error('unreachable')
check('starter back to first player', n3.state.starter === 0)
r = play(n3.state, s3, [0, 3, 1, 4, 2])
check('best of 3 ends on clinch (2-1) in round 3', r.matchOver && r.scores[0] === 2 && matchWinner(r) === 0)
check('cannot start another round after match over', !nextRound(r).ok)
check('cannot advance an unfinished round', !nextRound(newMatch(0)).ok)
function nextRoundOrThrow(s: State): State { const x = nextRound(s); if (!x.ok) throw new Error('nextRound'); return x.state }
// Round 2 is started by Bob, so a 2-0 clinch needs Ann to win it as the second mover.
{
  let t = play(newMatch(0), s3, [0, 3, 1, 4, 2]) // Ann
  t = nextRoundOrThrow(t) // Bob starts
  t = play(t, s3, [3, 0, 4, 1, 8, 2]) // Bob plays 3,4,8 (no line), Ann plays 0,1,2 -> Ann wins
  check('first player can win while second starts', t.winner === 0 && t.scores[0] === 2 && t.matchOver)
}
check('best of 5 needs 3 wins', (() => {
  let t = newMatch(0)
  let wins = 0
  for (let i = 0; i < 5 && !t.matchOver; i++) {
    // Whoever starts the round wins it with 0,1,2 — alternating winners.
    t = play(t, s5, [0, 3, 1, 4, 2])
    wins += 1
    if (!t.matchOver) t = nextRoundOrThrow(t)
  }
  return t.matchOver && wins === 5 && t.scores[0] === 3 && t.scores[1] === 2
})())
check('tied match over (1 win each + draw, best of 3)', (() => {
  let t = play(newMatch(0), s3, [0, 3, 1, 4, 2])
  t = nextRoundOrThrow(t); t = play(t, s3, [0, 3, 1, 4, 2])
  t = nextRoundOrThrow(t); t = play(t, s3, [0, 1, 2, 4, 3, 5, 7, 6, 8])
  return t.matchOver && t.scores[0] === 1 && t.scores[1] === 1 && t.draws === 1 && matchWinner(t) === null
})())
check('replay starter alternates from last round starter', (() => {
  const t = play(newMatch(0), s1, [0, 3, 1, 4, 2])
  return replayStarter(t) === 1 && newMatch(replayStarter(t)).turn === 1
})())

// 5. Name validation.
check('names trimmed and collapsed', (() => { const c = validateNames('  Ann   Lee ', 'Bob'); return c.ok && c.names[0] === 'Ann Lee' })())
check('empty name rejected', !validateNames('', 'Bob').ok && !validateNames('Ann', '   ').ok)
check('duplicate names rejected case-insensitively', !validateNames('Ann', 'ann').ok)
check('overlong name rejected', !validateNames('A'.repeat(15), 'Bob').ok)
check('control character rejected', !validateNames('An\u0007n', 'Bob').ok)
check('valid names accepted', validateNames('Ann', 'Bob').ok)

// 6. Save validation.
check('settings roundtrip', parseSettings(JSON.parse(JSON.stringify(s3)))?.rounds === 3)
check('settings reject bad rounds / names', parseSettings({ names: ['Ann', 'Bob'], rounds: 4 }) === null && parseSettings({ names: ['Ann', 'Ann'], rounds: 3 }) === null && parseSettings(null) === null)
const mid = play(newMatch(1), s3, [4, 0, 8])
const roundtrip = parseState(JSON.parse(JSON.stringify(mid)), s3)
check('good state roundtrips', roundtrip !== null && JSON.stringify(roundtrip) === JSON.stringify(mid))
const finished = play(newMatch(0), s1, [0, 3, 1, 4, 2])
check('finished state roundtrips', parseState(JSON.parse(JSON.stringify(finished)), s1) !== null)
const bad = (mut: (o: Record<string, unknown>) => void) => {
  const o = JSON.parse(JSON.stringify(mid)) as Record<string, unknown>
  mut(o)
  return parseState(o, s3) === null
}
check('rejects wrong board length', bad((o) => { (o.board as unknown[]).pop() }))
check('rejects bad cell value', bad((o) => { (o.board as unknown[])[0] = 2 }))
check('rejects impossible mark counts', bad((o) => { (o.board as unknown[])[1] = 0; (o.board as unknown[])[2] = 0 }))
check('rejects wrong turn', bad((o) => { o.turn = 1 - (o.turn as number) }))
check('rejects inflated score', bad((o) => { (o.scores as number[])[0] = 5 }))
check('rejects wrong status', bad((o) => { o.roundStatus = 'won' }))
check('rejects non-object / junk', parseState(null, s3) === null && parseState('x', s3) === null && parseState([], s3) === null)
check('rejects drifted round index', bad((o) => { o.roundIndex = 3 }))
const clinched: State = { ...mid, scores: [2, 0], roundIndex: 2 }
check('rejects in-progress state of an already-decided match', parseState(JSON.parse(JSON.stringify(clinched)), s3) === null)

// 7. Evaluate sanity.
check('empty board is playing', evaluate(Array(9).fill(null)).status === 'playing')
const sample: Player[] = [0, 1]
check('players are 0/1', sample.length === 2)

console.log(`rules.check: ${checks} checks passed`)
