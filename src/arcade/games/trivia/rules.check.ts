// Focused deterministic checks for Trivia Battle rules and the bundled question bank.
// Run:  node src/arcade/games/trivia/rules.check.ts   (non-zero exit on failure)
import { TRIVIA_CATEGORIES, TRIVIA_VERSION, categoryQuestions, questionById, validateTrivia } from '../../content/trivia.ts'
import { ranking } from '../../shared/rounds.ts'
import type { Random } from '../../shared/deck.ts'
import {
  answererOf, award, choose, declineTieBreak, newMatch, nextTurn, parseSettings, parseState, questionsNeeded, remainingQuestions,
  revealAnswer, showQuestion, splitMembers, startTieBreak, totalTurns, validateEntrants, winners,
  type Format, type Settings, type State,
} from './rules.ts'

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

// 1. Bundled bank.
check('trivia bank valid', validateTrivia(TRIVIA_CATEGORIES).length === 0)
check('60 questions in 6 categories, all ids resolvable', TRIVIA_CATEGORIES.length === 6 && categoryQuestions(TRIVIA_CATEGORIES.map((c) => c.id)).length === 60 && categoryQuestions(['space']).every((q) => questionById(q.id) === q))
check('validator catches bad questions', validateTrivia([{ id: 'x', name: 'x', questions: [{ id: 'x:0', q: '<b>hi</b>', a: 'a', w: ['a', 'b', 'c'], explanation: '' }] }]).length >= 3)

// Fixtures.
const players = (n: number, rounds = 2, format: Format = 'choice', points = 1): Settings => ({
  mode: 'players', entrants: Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, members: [] })), format, rounds, points, categoryIds: ['general'],
})
const pool = (n: number) => Array.from({ length: n }, (_, i) => `general:${i}`)
const start = (s: Settings, size = 10, seed = 1) => newMatch(s, pool(size), TRIVIA_VERSION, seeded(seed))

/** Display position holding the correct (or a wrong) option of the question on screen. */
const position = (st: State, correct: boolean): number => {
  const order = st.optionOrders[st.current!.q]
  return order.findIndex((id) => (id === 0) === correct)
}
/** Plays one whole turn (show -> answer -> reveal -> next). */
function turn(st: State, s: Settings, correct: boolean): State {
  let x = must(showQuestion(st, st.seq))
  if (s.format === 'choice') x = must(choose(x, s, x.seq, position(x, correct)))
  else x = must(award(must(revealAnswer(x, s, x.seq)), s, x.seq + 1, correct))
  return must(nextTurn(x, s, x.seq))
}

// 2. Setup: frozen shuffle, option orders.
{
  const s = players(3)
  const m = start(s)
  check('match starts ready with zero scores and nothing drawn', m.phase === 'ready' && m.cursor === 0 && m.scores.every((x) => x === 0) && m.seq === 0)
  check('order is a permutation of the pool', [...m.order].sort().join() === [...pool(10)].sort().join())
  check('every option order is a permutation of 0..3', m.optionOrders.length === 10 && m.optionOrders.every((o) => [...o].sort().join() === '0,1,2,3'))
  check('different seeds shuffle differently', start(s, 10, 2).order.join() !== m.order.join())
  check('questions needed = participants x rounds', questionsNeeded(s) === 6 && totalTurns(s) === 6)
}

// 3. Multiple choice: answer mapping, locking, scoring, turn order, no speed scoring.
{
  const s = players(2, 2, 'choice', 2)
  let m = start(s)
  const shown = must(showQuestion(m, 0))
  check('showing a question draws one and keeps option ids hidden from state view', shown.phase === 'question' && shown.cursor === 1 && shown.current!.chosen === null && shown.current!.correct === null)
  // Every display position maps to the right option id.
  for (let pos = 0; pos < 4; pos++) {
    const r = must(choose(shown, s, shown.seq, pos))
    const id = shown.optionOrders[shown.current!.q][pos]
    check(`position ${pos} maps to option ${id}`, r.current!.chosen === id && r.current!.correct === (id === 0) && r.scores[0] === (id === 0 ? 2 : 0))
  }
  const answered = must(choose(shown, s, shown.seq, position(shown, true)))
  check('correct answer scores the point value and shows the result', answered.phase === 'reveal' && answered.scores[0] === 2 && answered.current!.correct === true)
  check('answer is locked: a second pick is rejected (same and stale seq)', !choose(answered, s, answered.seq, 0).ok && !choose(answered, s, shown.seq, 0).ok)
  check('double tap with the same seq cannot score twice', (() => { const a = choose(shown, s, shown.seq, position(shown, true)); return a.ok && !choose(a.state, s, shown.seq, position(shown, true)).ok })())
  const n1 = must(nextTurn(answered, s, answered.seq))
  check('next turn passes to the other player, ready, nothing on screen', n1.phase === 'ready' && n1.participant === 1 && n1.current === null && n1.turn === 1)
  check('cannot show a question twice or skip the reveal', !showQuestion(shown, shown.seq).ok && !nextTurn(shown, s, shown.seq).ok)
  check('wrong-format actions rejected in choice format', !revealAnswer(shown, s, shown.seq).ok && !award(shown, s, shown.seq, true).ok)
  check('out-of-range picks rejected', [-1, 4, 1.5, NaN].every((p) => !choose(shown, s, shown.seq, p).ok))
  check('actions do not mutate their input', (() => { const b = JSON.stringify(shown); choose(shown, s, shown.seq, 0); return JSON.stringify(shown) === b })())
  // Full regulation: 2 players x 2 rounds, P1 right twice, P2 wrong twice.
  m = start(s)
  const order: number[] = []
  for (let i = 0; i < 4; i++) {
    order.push(m.participant)
    m = turn(m, s, m.participant === 0)
  }
  check('turns alternate P1,P2,P1,P2 and each answers `rounds` questions', order.join('') === '0101' && m.answered.join() === '2,2')
  check('decided match ends with one winner and no tie', m.phase === 'over' && m.scores.join() === '4,0' && winners(m).join() === '0' && m.shared === null && m.turn === 4)
  check('nothing can be done after the match is over', !showQuestion(m, m.seq).ok && !nextTurn(m, s, m.seq).ok && !startTieBreak(m, m.seq).ok)
  check('final ranking', JSON.stringify(ranking(m.scores).map((r) => [r.team, r.rank])) === '[[0,1],[1,2]]')
}

// 4. Quizmaster (host) format: concealment order, single award.
{
  const s = players(2, 2, 'host', 3)
  const shown = must(showQuestion(start(s), 0))
  check('award before the reveal is rejected (answer concealed until deliberate reveal)', !award(shown, s, shown.seq, true).ok)
  check('choice action rejected in host format', !choose(shown, s, shown.seq, 0).ok)
  const revealed = must(revealAnswer(shown, s, shown.seq))
  check('reveal is explicit, once, and does not score', revealed.current!.answerShown && revealed.scores[0] === 0 && !revealAnswer(revealed, s, revealed.seq).ok)
  const done = must(award(revealed, s, revealed.seq, true))
  check('award scores the point value exactly once', done.scores[0] === 3 && done.phase === 'reveal' && !award(done, s, done.seq, true).ok && !award(done, s, revealed.seq, true).ok)
  const wrong = must(award(must(revealAnswer(must(showQuestion(start(s), 0)), s, 1)), s, 2, false))
  check('incorrect award scores nothing but still counts as answered', wrong.scores[0] === 0 && wrong.answered[0] === 1)
  let m = start(s)
  for (let i = 0; i < 4; i++) m = turn(m, s, i % 2 === 0)
  check('host regulation completes', m.phase === 'over' && m.scores.join() === '6,0')
}

// 5. Teams with unequal sizes: member rotation, equal question counts.
{
  const s: Settings = {
    mode: 'teams', format: 'choice', rounds: 3, points: 1, categoryIds: ['general'],
    entrants: [{ name: 'Solo', members: ['Asha'] }, { name: 'Trio', members: ['Ben', 'Chi', 'Dev'] }],
  }
  let m = start(s)
  const who: string[] = []
  for (let i = 0; i < totalTurns(s); i++) {
    who.push(`${s.entrants[m.participant].name}:${answererOf(m, s)}`)
    m = turn(m, s, i % 3 === 0)
  }
  check('member rotates inside each team independently', who.join(' ') === 'Solo:Asha Trio:Ben Solo:Asha Trio:Chi Solo:Asha Trio:Dev')
  check('both teams get the same number of questions despite unequal sizes', m.answered.join() === '3,3')
  check('players mode has no member', answererOf(start(players(2)), players(2)) === null)
}

// 6. Ties and tie-break.
{
  const s = players(2, 2, 'host')
  let m = start(s, 12)
  for (let i = 0; i < 4; i++) m = turn(m, s, true)
  check('level scores after regulation enter the tie prompt, not over', m.phase === 'tie' && m.tie!.ids.join() === '0,1' && m.tie!.queue.length === 0 && m.turn === 4)
  check('only tie actions are allowed in the tie prompt', !showQuestion(m, m.seq).ok && !nextTurn(m, s, m.seq).ok)
  // Cycle 1: both right -> tied again.
  let t = must(startTieBreak(m, m.seq))
  check('tie-break gives each tied side one more question in order', t.phase === 'ready' && t.participant === 0 && t.tie!.queue.join() === '0,1' && t.tie!.cycle === 1)
  const drawnBefore = t.cursor
  t = turn(t, s, true)
  check('after the first tied answer the other tied side is up', t.phase === 'ready' && t.participant === 1 && t.tie!.queue.join() === '1')
  t = turn(t, s, true)
  check('still level after a cycle: prompt again, cycle recorded', t.phase === 'tie' && t.tie!.ids.join() === '0,1' && t.cursor === drawnBefore + 2 && t.tie!.cycle === 1)
  // Cycle 2: P1 right, P2 wrong -> P1 wins.
  let u = must(startTieBreak(t, t.seq))
  check('second cycle numbered 2', u.tie!.cycle === 2)
  u = turn(u, s, true)
  u = turn(u, s, false)
  check('one side leads after a cycle: match over with that winner, scores kept', u.phase === 'over' && winners(u).join() === '0' && u.scores.join() === '4,3' && u.tie === null && u.shared === null)
  // Decline -> shared win.
  const d = must(declineTieBreak(m, m.seq))
  check('declining the tie-break shares the win between the tied sides', d.phase === 'over' && d.shared!.join() === '0,1' && winners(d).join() === '0,1')
  check('shared winners rank equal first', ranking(d.scores).every((r) => r.rank === 1))
  check('decline/start rejected when there is no tie or a stale seq', !declineTieBreak(u, u.seq).ok && !startTieBreak(m, m.seq - 1).ok)
}
// Three-way tie where only two stay level.
{
  const s = players(3, 2, 'host')
  let m = start(s, 20)
  // regulation: turns P1,P2,P3,P1,P2,P3; P1 right twice, P2 right twice, P3 wrong twice.
  const plan = [true, true, false, true, true, false]
  for (const c of plan) m = turn(m, s, c)
  check('two of three level at the top: only they are in the tie', m.phase === 'tie' && m.tie!.ids.join() === '0,1' && m.scores.join() === '2,2,0')
  let t = must(startTieBreak(m, m.seq))
  t = turn(t, s, true)
  t = turn(t, s, false)
  check('the eliminated side (P3) never plays in the tie-break and the leader wins', t.phase === 'over' && winners(t).join() === '0' && t.answered[2] === 2)
}
// Exhausted bank: not enough questions left for a tie-break cycle -> shared win automatically.
{
  const s = players(2, 2, 'host')
  let m = start(s, 4)
  for (let i = 0; i < 4; i++) m = turn(m, s, true)
  check('bank exhausted at a tie: match ends with a shared win, no prompt', m.phase === 'over' && m.shared!.join() === '0,1' && remainingQuestions(m) === 0)
  // One question left but two tied sides -> still shared.
  let m5 = start(s, 5)
  for (let i = 0; i < 4; i++) m5 = turn(m5, s, true)
  check('one question left for two tied sides is not enough: shared win', m5.phase === 'over' && m5.shared!.join() === '0,1' && remainingQuestions(m5) === 1)
  // Bank runs out in the middle of tie-breaks.
  let m6 = start(s, 6)
  for (let i = 0; i < 4; i++) m6 = turn(m6, s, true)
  check('two left for two tied sides: tie prompt offered', m6.phase === 'tie')
  let t6 = must(startTieBreak(m6, m6.seq))
  t6 = turn(turn(t6, s, true), s, true)
  check('after using the last questions a continuing tie becomes a shared win', t6.phase === 'over' && t6.shared!.join() === '0,1')
  check('startTieBreak rejects when the bank cannot cover a cycle', (() => {
    // Forge a tie prompt with too few questions left.
    const forged: State = { ...m6, cursor: m6.order.length - 1 }
    return !startTieBreak(forged, forged.seq).ok
  })())
}
// Everyone at zero is also a tie.
{
  const s = players(2, 2, 'choice')
  let m = start(s, 12)
  for (let i = 0; i < 4; i++) m = turn(m, s, false)
  check('all wrong (0-0) is a tie too', m.phase === 'tie' && m.tie!.ids.join() === '0,1')
}

// 7. Setup validation.
{
  const ok = (mode: 'players' | 'teams', rows: { name: string; members: string }[]) => validateEntrants(mode, rows)
  check('players ok, trimmed', ok('players', [{ name: ' Ann  Lee ', members: '' }, { name: 'Bob', members: '' }]).entrants[0].name === 'Ann Lee')
  check('player rules: names required, distinct, <=14, 2..6', !ok('players', [{ name: '', members: '' }, { name: 'B', members: '' }]).ok && !ok('players', [{ name: 'a', members: '' }, { name: 'A', members: '' }]).ok && !ok('players', [{ name: 'A'.repeat(15), members: '' }, { name: 'B', members: '' }]).ok && !ok('players', [{ name: 'a', members: '' }]).ok && !ok('players', Array.from({ length: 7 }, (_, i) => ({ name: `p${i}`, members: '' }))).ok && ok('players', Array.from({ length: 6 }, (_, i) => ({ name: `p${i}`, members: '' }))).ok)
  check('team rules: members required, <=5, distinct, 2..4 teams', ok('teams', [{ name: 'A', members: 'x, y' }, { name: 'B', members: 'z' }]).ok && !ok('teams', [{ name: 'A', members: '' }, { name: 'B', members: 'z' }]).ok && !ok('teams', [{ name: 'A', members: 'a,b,c,d,e,f' }, { name: 'B', members: 'z' }]).ok && !ok('teams', [{ name: 'A', members: 'x, X' }, { name: 'B', members: 'z' }]).ok && !ok('teams', Array.from({ length: 5 }, (_, i) => ({ name: `t${i}`, members: 'm' }))).ok)
  check('splitMembers trims and drops empties', splitMembers(' a ,, b  ,c ').join('|') === 'a|b|c')
  const good = players(3)
  const parsedGood = parseSettings(JSON.parse(JSON.stringify(good)), ['general', 'space'])
  check('settings roundtrip', parsedGood !== null && parsedGood.entrants.length === 3 && parsedGood.rounds === 2 && parsedGood.format === 'choice')
  const teamS: Settings = { mode: 'teams', format: 'host', rounds: 3, points: 2, categoryIds: ['space'], entrants: [{ name: 'A', members: ['x', 'y'] }, { name: 'B', members: ['z'] }] }
  const parsedTeams = parseSettings(JSON.parse(JSON.stringify(teamS)), ['general', 'space'])
  check('team settings roundtrip', parsedTeams !== null && parsedTeams.mode === 'teams' && parsedTeams.points === 2 && parsedTeams.entrants.map((e) => `${e.name}:${e.members.join('+')}`).join() === 'A:x+y,B:z')
  check('settings reject bad input', [
    { ...good, rounds: 4 }, { ...good, points: 5 }, { ...good, format: 'x' }, { ...good, mode: 'x' }, { ...good, categoryIds: [] }, { ...good, categoryIds: ['nope'] },
    { ...good, categoryIds: ['general', 'general'] }, { ...good, entrants: [{ name: 'A', members: ['x'] }, { name: 'B', members: [] }] }, { ...teamS, entrants: [{ name: 'A', members: [] }, { name: 'B', members: ['z'] }] }, null,
  ].every((x) => parseSettings(x, ['general', 'space']) === null))
}

// 8. Save validation across phases, formats, ties and shared wins.
{
  const s = players(2, 2, 'choice', 2)
  const pids = pool(12)
  const rt = (x: State, cfg: Settings = s, ids: string[] = pids) => parseState(JSON.parse(JSON.stringify(x)), cfg, ids, TRIVIA_VERSION)
  const ready = start(s, 12)
  const asking = must(showQuestion(ready, 0))
  const revealed = must(choose(asking, s, asking.seq, position(asking, true)))
  const states: State[] = [ready, asking, revealed, must(nextTurn(revealed, s, revealed.seq))]
  check('ready / asking / reveal / next states round-trip', states.every((x) => JSON.stringify(rt(x)) === JSON.stringify(x)))
  const hs = players(2, 2, 'host')
  let h = start(hs, 12)
  const hAsk = must(showQuestion(h, 0))
  const hRev = must(revealAnswer(hAsk, hs, hAsk.seq))
  const hDone = must(award(hRev, hs, hRev.seq, true))
  check('host states round-trip (asking, revealed, awarded)', [hAsk, hRev, hDone].every((x) => JSON.stringify(rt(x, hs)) === JSON.stringify(x)))
  for (let i = 0; i < 4; i++) h = turn(h, hs, true)
  const tieState = h
  const inTie = must(startTieBreak(tieState, tieState.seq))
  const tieAsk = must(showQuestion(inTie, inTie.seq))
  const shared = must(declineTieBreak(tieState, tieState.seq))
  const decided = (() => { let x = start(s, 12); for (let i = 0; i < 4; i++) x = turn(x, s, i % 2 === 0); return x })()
  check('tie prompt, tie-break ready/asking, shared win and decided win round-trip', [tieState, inTie, tieAsk].every((x) => rt(x, hs) !== null) && rt(shared, hs) !== null && rt(decided) !== null)

  const bad = (src: State, mut: (o: Record<string, unknown>) => void, cfg: Settings = s, ids: string[] = pids) => {
    const o = JSON.parse(JSON.stringify(src)) as Record<string, unknown>
    mut(o)
    return parseState(o, cfg, ids, TRIVIA_VERSION) === null
  }
  check('rejects a different pack version', parseState(JSON.parse(JSON.stringify(ready)), s, pids, TRIVIA_VERSION + 1) === null)
  check('rejects an order that is not the selected pool', bad(ready, (o) => { (o.order as string[])[0] = 'general:99' }) && bad(ready, (o) => { (o.order as string[])[0] = (o.order as string[])[1] }) && parseState(JSON.parse(JSON.stringify(ready)), s, pids.slice(1), TRIVIA_VERSION) === null)
  check('rejects bad option orders', bad(ready, (o) => { (o.optionOrders as number[][])[0][0] = 7 }) && bad(ready, (o) => { (o.optionOrders as number[][]).pop() }) && bad(ready, (o) => { (o.optionOrders as number[][])[1] = [0, 0, 1, 2] }))
  check('rejects wrong score/answered arrays and non-multiples of the point value', bad(revealed, (o) => { (o.scores as number[]).pop() }) && bad(revealed, (o) => { (o.scores as number[])[0] = 1 }) && bad(revealed, (o) => { (o.answered as number[])[0] = 5 }) && bad(ready, (o) => { (o.scores as number[])[0] = 4 }))
  check('rejects a result that does not match the chosen option (choice)', bad(revealed, (o) => { (o.current as { correct: boolean }).correct = false }) && bad(revealed, (o) => { (o.current as { chosen: number | null }).chosen = null }))
  check('rejects a question screen that already has an answer', bad(asking, (o) => { (o.current as { chosen: number }).chosen = 0 }) && bad(asking, (o) => { (o.current as { answerShown: boolean }).answerShown = true }))
  check('rejects phase/current mismatches', bad(ready, (o) => { o.current = { q: 0, chosen: null, answerShown: false, correct: null } }) && bad(asking, (o) => { o.current = null }) && bad(asking, (o) => { (o.current as { q: number }).q = 3 }))
  check('rejects wrong participant for the turn', bad(states[3], (o) => { o.participant = 0 }))
  check('rejects a host award without a reveal', bad(hDone, (o) => { (o.current as { answerShown: boolean }).answerShown = false }, hs))
  check('rejects tie bookkeeping that does not fit', bad(tieState, (o) => { o.tie = null }, hs) && bad(tieState, (o) => { (o.tie as { ids: number[] }).ids = [0] }, hs) && bad(inTie, (o) => { (o.tie as { queue: number[] }).queue = [] }, hs) && bad(inTie, (o) => { (o.tie as { queue: number[] }).queue = [1, 0] }, hs) && bad(ready, (o) => { o.tie = { cycle: 0, ids: [0, 1], queue: [] } }, s))
  check('rejects an unjustified shared win or a decided win with a tie', bad(decided, (o) => { o.shared = [0, 1] }) && bad(shared, (o) => { o.shared = [0] }, hs) && bad(decided, (o) => { o.scores = [2, 2] }))
  check('rejects an over state with the wrong turn count', bad(decided, (o) => { o.turn = 1 }))
  check('rejects seq/cursor/turn junk', bad(ready, (o) => { o.cursor = 99 }) && bad(ready, (o) => { o.turn = 99 }) && bad(ready, (o) => { o.seq = -1 }) && bad(ready, (o) => { o.phase = 'nope' }))
  check('rejects junk input', parseState(null, s, pids, TRIVIA_VERSION) === null && parseState('x', s, pids, TRIVIA_VERSION) === null && parseState([], s, pids, TRIVIA_VERSION) === null)
}

console.log(`trivia rules.check: ${checks} checks passed`)
