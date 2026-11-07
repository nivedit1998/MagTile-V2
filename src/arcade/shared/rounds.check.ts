// Focused deterministic checks for the shared deck, timer and team-round machine.
// Run:  node src/arcade/shared/rounds.check.ts   (non-zero exit on failure)
import { cardsLeft, draw, newDeck, parseDeck, shuffled, type Random } from './deck.ts'
import {
  MIN_POOL, cardToken, markCorrect, markPass, newRounds, nextTurn, parseRoundSettings, parseRoundState, pauseTurn, ranking,
  finishTurn, isUnlimited, reconcile, resumeTurn, startTurn, validateTeamNames, type RoundSettings, type RoundState,
} from './rounds.ts'
import { displaySeconds, idleTimer, isExpired, parseTimer, pause, remaining, resume, startTimer } from './timer.ts'

let checks = 0
function check(name: string, ok: boolean): void {
  checks += 1
  if (!ok) throw new Error(`FAILED: ${name}`)
}
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

// 1. Deck: permutation, no repeats before exhaustion, reshuffle, no immediate repeat.
for (const size of [1, 2, 5, 12, 40]) {
  const order = shuffled(size, seeded(size))
  check(`shuffled(${size}) is a permutation`, [...order].sort((a, b) => a - b).every((v, i) => v === i))
}
{
  const size = 12
  let deck = newDeck(size, seeded(3))
  const seen: number[] = []
  let last: number | null = null
  for (let i = 0; i < size; i++) {
    const d = draw(deck, size, seeded(100 + i), last)
    check('no reshuffle while cards remain', !d.reshuffled)
    seen.push(d.index!)
    deck = d.deck
    last = d.index
  }
  check('a full pass draws every card exactly once', new Set(seen).size === size)
  check('cardsLeft hits zero', cardsLeft(deck, size) === 0)
  const next = draw(deck, size, seeded(999), last)
  check('exhausted pile reshuffles and counts it', next.reshuffled && next.deck.reshuffles === 1 && next.index !== null)
  check('card just drawn is not first after reshuffle (many seeds)', Array.from({ length: 60 }, (_, s) => draw(deck, size, seeded(s), last).index !== last).every(Boolean))
  check('empty pool draws nothing', draw(newDeck(0, seeded(1)), 0, seeded(1)).index === null)
  check('draw does not mutate its input', (() => { const d0 = newDeck(5, seeded(1)); const b = JSON.stringify(d0); draw(d0, 5, seeded(2)); return JSON.stringify(d0) === b })())
}
check('parseDeck accepts a valid deck', parseDeck({ order: [2, 0, 1], cursor: 1, reshuffles: 0 }, 3) !== null)
check('parseDeck rejects bad decks', [
  { order: [0, 0, 1], cursor: 0, reshuffles: 0 }, { order: [0, 1], cursor: 0, reshuffles: 0 }, { order: [0, 1, 3], cursor: 0, reshuffles: 0 },
  { order: [0, 1, 2], cursor: 4, reshuffles: 0 }, { order: [0, 1, 2], cursor: -1, reshuffles: 0 }, { order: [0, 1, 2], cursor: 0, reshuffles: -1 }, null, 'x', [],
].every((x) => parseDeck(x, 3) === null))

// 2. Timer: pause/resume, absolute deadline, sleep reconciliation.
{
  const t0 = startTimer(60_000, 1_000)
  check('timer remaining counts down', remaining(t0, 11_000) === 50_000 && !isExpired(t0, 60_999) && isExpired(t0, 61_000))
  const p = pause(t0, 21_000)
  check('pause freezes', p.endsAt === null && remaining(p, 999_999) === 40_000)
  const r = resume(p, 100_000)
  check('resume continues from the frozen value', remaining(r, 110_000) === 30_000 && r.endsAt === 140_000)
  check('pause of a paused timer and resume of a running one are no-ops', pause(p, 5) === p && resume(r, 5) === r)
  check('remaining never negative', remaining(t0, 9_999_999) === 0)
  check('display rounds up', displaySeconds(59_001) === 60 && displaySeconds(1) === 1 && displaySeconds(0) === 0)
  check('parseTimer', parseTimer({ endsAt: null, remainingMs: 100 }, 60_000) !== null && parseTimer({ endsAt: null, remainingMs: 70_000 }, 60_000) === null && parseTimer({ endsAt: 'x', remainingMs: 1 }, 60_000) === null && parseTimer(null, 60_000) === null)
  check('idle timer holds its duration', remaining(idleTimer(30_000), 5) === 30_000)
}

// 3. Round machine.
const settings: RoundSettings = { teams: ['Red', 'Blue'], turnsPerTeam: 2, turnSeconds: 60, categoryIds: ['a'] }
const POOL = 15
const T0 = 1_000_000
let s: RoundState = newRounds(settings, POOL, seeded(5))
check('starts ready with zero scores', s.phase === 'ready' && s.scores.every((x) => x === 0) && s.card === null)
check('cannot answer before the turn starts', !markCorrect(s, settings, 0, T0, seeded(1)).ok)
s = must(startTurn(s, settings, T0, seeded(1)))
check('turn starts with a card and a running timer', s.phase === 'playing' && s.card !== null && s.timer.endsAt === T0 + 60_000)
check('cannot start twice', !startTurn(s, settings, T0, seeded(1)).ok)

// Double tap: the same token cannot score twice.
{
  const token = cardToken(s)
  const first = markCorrect(s, settings, token, T0 + 1000, seeded(2))
  check('first correct scores', first.ok && first.state.scores[0] === 1)
  if (!first.ok) throw new Error('unreachable')
  const second = markCorrect(first.state, settings, token, T0 + 1010, seeded(2))
  check('double tap (same token) is rejected, no duplicate score', !second.ok && second.reason === 'stale-card' && first.state.scores[0] === 1)
  const passAgain = markPass(first.state, settings, token, T0 + 1010, seeded(2))
  check('stale pass is rejected too', !passAgain.ok)
  s = first.state
}
{
  const before = JSON.stringify(s)
  markPass(s, settings, cardToken(s), T0 + 2000, seeded(3))
  check('actions do not mutate their input', JSON.stringify(s) === before)
  const passed = must(markPass(s, settings, cardToken(s), T0 + 2000, seeded(3)))
  check('pass scores nothing and records the card', passed.scores[0] === 1 && passed.passed.length === 1 && passed.correct.length === 1)
  s = passed
}
// No repeats within a deck across a turn: draw the whole pool.
{
  let t = must(startTurn(newRounds(settings, POOL, seeded(9)), settings, T0, seeded(1)))
  const drawn = [t.card!]
  for (let i = 0; i < POOL - 1; i++) {
    t = must(markPass(t, settings, cardToken(t), T0 + 1000, seeded(i)))
    drawn.push(t.card!)
  }
  check('first POOL cards of a deck are all distinct', new Set(drawn).size === POOL)
  check('no reshuffle yet', t.deck.reshuffles === 0)
  const after = must(markPass(t, settings, cardToken(t), T0 + 1000, seeded(77)))
  check('exhausted deck reshuffles and keeps going without repeating the last card', after.deck.reshuffles === 1 && after.card !== t.card)
  check('tokens stay monotonic across a reshuffle', cardToken(after) > cardToken(t))
}
// Expiry and sleep reconciliation.
{
  const live = s
  check('reconcile before the deadline changes nothing', reconcile(live, T0 + 59_000) === live)
  check('answers after the deadline are rejected', !markCorrect(live, settings, cardToken(live), T0 + 60_000, seeded(1)).ok)
  const slept = reconcile(live, T0 + 3_600_000) // the device slept for an hour
  check('sleeping past the deadline ends the turn with the card consumed', slept.phase === 'summary' && slept.card === null && slept.skipped.length === 1 && slept.scores[0] === live.scores[0])
  check('reconcile twice is stable', reconcile(slept, T0 + 3_700_000) === slept)
}
// Pause / resume.
{
  const p = must(pauseTurn(s, T0 + 10_000))
  check('pause freezes the clock and hides the card state', p.phase === 'paused' && p.timer.endsAt === null && p.timer.remainingMs === 50_000)
  check('no scoring while paused', !markCorrect(p, settings, cardToken(p), T0 + 20_000, seeded(1)).ok)
  check('reconcile ignores a paused turn however long it stays paused', reconcile(p, T0 + 9_999_999) === p)
  const r = must(resumeTurn(p, T0 + 500_000))
  check('resume continues with the frozen time', r.phase === 'playing' && r.timer.endsAt === T0 + 550_000)
  check('cannot pause an expired turn', !pauseTurn(s, T0 + 70_000).ok)
}
// Turn order and final result.
{
  let t = must(startTurn(newRounds(settings, POOL, seeded(4)), settings, T0, seeded(1)))
  const order: number[] = []
  for (let i = 0; i < 4; i++) {
    order.push(t.turn % 2)
    t = must(markCorrect(t, settings, cardToken(t), T0 + 1000, seeded(i)))
    t = reconcile(t, T0 + 60_000)
    check(`turn ${i} ends in a summary`, t.phase === 'summary')
    t = must(nextTurn(t, settings))
    if (i < 3) {
      check('next turn is ready, lists cleared', t.phase === 'ready' && t.correct.length === 0 && t.card === null)
      t = must(startTurn(t, settings, T0, seeded(10 + i)))
    }
  }
  check('teams alternate Red, Blue, Red, Blue', order.join('') === '0101')
  check('game ends after turnsPerTeam x teams turns', t.phase === 'over' && t.scores[0] === 2 && t.scores[1] === 2)
  check('cannot advance past over', !nextTurn(t, settings).ok)
}
check('ranking with ties', JSON.stringify(ranking([3, 5, 3, 1]).map((r) => [r.team, r.rank])) === JSON.stringify([[1, 1], [0, 2], [2, 2], [3, 4]]))
check('ranking all tied', ranking([2, 2, 2]).every((r) => r.rank === 1))

// 4. Setup validation.
check('team names ok', validateTeamNames(['Red', 'Blue']).ok && validateTeamNames([' Red  Team ', 'Blue', 'Green']).names[0] === 'Red Team')
check('team names rejected', !validateTeamNames(['', 'Blue']).ok && !validateTeamNames(['Red', 'red']).ok && !validateTeamNames(['A'.repeat(15), 'B']).ok && !validateTeamNames(['Solo']).ok && !validateTeamNames(['a', 'b', 'c', 'd', 'e']).ok)
check('settings parse', parseRoundSettings(JSON.parse(JSON.stringify(settings)), ['a', 'b']) !== null)
check('settings reject bad input', [
  { ...settings, turnsPerTeam: 9 }, { ...settings, turnSeconds: 45 }, { ...settings, categoryIds: [] }, { ...settings, categoryIds: ['zzz'] },
  { ...settings, categoryIds: ['a', 'a'] }, { ...settings, teams: ['Red', 'red'] }, null,
].every((x) => parseRoundSettings(x, ['a', 'b']) === null))

// 5. Save validation.
{
  const mid = must(markCorrect(must(startTurn(newRounds(settings, POOL, seeded(6)), settings, T0, seeded(1))), settings, 1, T0 + 100, seeded(2)))
  const round = (x: RoundState) => parseRoundState(JSON.parse(JSON.stringify(x)), settings, POOL)
  check('mid-turn state roundtrips', JSON.stringify(round(mid)) === JSON.stringify(mid))
  check('ready/paused/summary states roundtrip', round(newRounds(settings, POOL, seeded(1))) !== null && round(must(pauseTurn(mid, T0 + 200))) !== null && round(reconcile(mid, T0 + 99_999_999)) !== null)
  const bad = (mut: (o: Record<string, unknown>) => void) => {
    const o = JSON.parse(JSON.stringify(mid)) as Record<string, unknown>
    mut(o)
    return parseRoundState(o, settings, POOL) === null
  }
  check('rejects pool size drift', parseRoundState(JSON.parse(JSON.stringify(mid)), settings, POOL + 1) === null)
  check('rejects corrupt deck', bad((o) => { (o.deck as { order: number[] }).order[0] = (o.deck as { order: number[] }).order[1] }))
  check('rejects wrong score length / negative score', bad((o) => { (o.scores as number[]).pop() }) && bad((o) => { (o.scores as number[])[0] = -1 }))
  check('rejects playing without a card or a deadline', bad((o) => { o.card = null }) && bad((o) => { (o.timer as { endsAt: unknown }).endsAt = null }))
  check('rejects bad phase / turn', bad((o) => { o.phase = 'nope' }) && bad((o) => { o.turn = 99 }))
  check('rejects lists longer than cards drawn', bad((o) => { o.passed = Array.from({ length: 12 }, (_, i) => i) }))
  check('rejects a ready phase with leftover cards', bad((o) => { o.phase = 'ready'; o.card = null; (o.timer as { endsAt: unknown }).endsAt = null }))
  check('rejects junk', parseRoundState(null, settings, POOL) === null && parseRoundState('x', settings, POOL) === null && parseRoundState([], settings, POOL) === null)
  check('rejects a pool below the minimum', parseRoundState(JSON.parse(JSON.stringify(mid)), settings, MIN_POOL - 1) === null)
}

// No time limit: the players keep their own time and end the turn with a button.
{
  const free: RoundSettings = { ...settings, turnSeconds: 0 }
  check('0 seconds is accepted as no limit', parseRoundSettings(free, ['a']) !== null && isUnlimited(free) && !isUnlimited(settings))
  let u = must(startTurn(newRounds(free, POOL, seeded(7)), free, T0, seeded(1)))
  check('an unlimited turn starts with no deadline', u.phase === 'playing' && u.timer.endsAt === null && u.card !== null)
  check('an unlimited turn never expires, even after days', reconcile(u, T0 + 7 * 86_400_000) === u)
  u = must(markCorrect(u, free, cardToken(u), T0 + 999_999_999, seeded(2)))
  check('scoring still works long after any normal deadline', u.scores[0] === 1 && u.correct.length === 1)
  const p = must(pauseTurn(u, T0 + 1000))
  check('pause and resume keep an unlimited turn deadline-free', p.phase === 'paused' && must(resumeTurn(p, T0 + 2000)).timer.endsAt === null)
  check('an unlimited playing state survives save and load', parseRoundState(JSON.parse(JSON.stringify(u)), free, POOL) !== null)
  check('a timed state is rejected under unlimited settings and the reverse', parseRoundState(JSON.parse(JSON.stringify(s)), free, POOL) === null && parseRoundState(JSON.parse(JSON.stringify(u)), settings, POOL) === null)
  const ended = must(finishTurn(u))
  check('End turn goes to the summary, keeps scores and marks the card unfinished', ended.phase === 'summary' && ended.card === null && ended.skipped.length === 1 && ended.scores[0] === 1 && ended.correct.length === 1)
  check('End turn works on a timed turn too, but not outside a turn', finishTurn(s).ok && !finishTurn(ended).ok && !finishTurn(newRounds(free, POOL, seeded(1))).ok)
  check('summary then moves on as usual', must(nextTurn(ended, free)).phase === 'ready')
}

console.log(`rounds.check: ${checks} checks passed`)
