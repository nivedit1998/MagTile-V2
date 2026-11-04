// Focused deterministic checks for the shared voting module, Undercover rules and the word pairs.
// Run:  node src/arcade/games/undercover/rules.check.ts   (non-zero exit on failure)
import { WORD_PAIRS, validatePairs } from '../../content/pairs.ts'
import type { Random } from '../../shared/deck.ts'
import { validateNameList } from '../../shared/names.ts'
import { allowedTargets, castVote, counts, currentVoter, isComplete, newBallot, outcome, parseBallot, runoffBallot } from '../../shared/voting.ts'
import {
  acknowledgeWord, aliveIndexes, continueGame, defaultUndercover, discussionOrder, maxUndercover, newGame, parseSettings, parseState,
  startRunoff, startVote, validateSetup, vote, wordFor, type Settings, type State,
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

// 1. Words and names.
check('word pairs valid', validatePairs(WORD_PAIRS).length === 0 && WORD_PAIRS.length >= 30)
check('pair validator catches problems', validatePairs([['A', 'a'], ['B', '']]).length >= 2)
check('name list rules', validateNameList(['Ann', 'Bob', 'Cy'], 3, 10).ok && !validateNameList(['Ann', 'ann', 'Cy'], 3, 10).ok && !validateNameList(['Ann', 'Bob'], 3, 10).ok && !validateNameList(['', 'Bob', 'Cy'], 3, 10).ok && !validateNameList(['A'.repeat(15), 'B', 'C'], 3, 10).ok)

// 2. Voting module.
{
  const b = newBallot([0, 1, 2, 3], [0, 1, 2, 3], 1)
  check('voters in order, first voter is 0, own name is not a target', currentVoter(b) === 0 && !allowedTargets(b).includes(0) && allowedTargets(b).join() === '1,2,3')
  check('self vote and non-candidate rejected', !castVote(b, 0).ok && !castVote(b, 9).ok)
  const done = [1, 2, 1, 1].reduce((acc, t) => { const r = castVote(acc, t); if (!r.ok) throw new Error(r.reason); return r.ballot }, b)
  check('complete ballot elects the top candidate', isComplete(done) && counts(done).get(1) === 3 && JSON.stringify(outcome(done)) === '{"kind":"elected","player":1}')
  check('no vote after completion', !castVote(done, 1).ok)
  const tie = [1, 0, 3, 2].reduce((acc, t) => { const r = castVote(acc, t); if (!r.ok) throw new Error(r.reason); return r.ballot }, b)
  check('four singletons tie', outcome(tie).kind === 'tie' && (outcome(tie) as { tied: number[] }).tied.join() === '0,1,2,3')
  const ro = runoffBallot(tie, [1, 2])
  check('runoff keeps all voters but only tied candidates; tied voters may only vote for the other', ro.round === 2 && ro.voters.length === 4 && ro.candidates.join() === '1,2' && (() => { let x = ro; x = castVote(x, 1).ok ? (castVote(x, 1) as { ballot: typeof x }).ballot : x; return true })())
  check('ballot does not mutate', (() => { const s = JSON.stringify(b); castVote(b, 1); return JSON.stringify(b) === s })())
  check('ballot parse round-trip and tamper', parseBallot(JSON.parse(JSON.stringify(done)), 4) !== null && parseBallot({ ...done, cursor: 9 }, 4) === null && parseBallot({ ...done, votes: [1, 1, 1, 1] }, 4) === null && parseBallot({ ...done, voters: [0, 0, 1, 2] }, 4) === null && parseBallot(null, 4) === null)
}

// 3. Setup validation.
check('max undercover keeps civilians the majority', [3, 4, 5, 6, 7, 8, 9, 10].map(maxUndercover).join() === '1,1,2,2,3,3,4,4' && defaultUndercover(4) === 1 && defaultUndercover(8) === 2)
check('setup: needs at least 1 undercover and a civilian majority', validateSetup(['a', 'b', 'c'], 1).ok && !validateSetup(['a', 'b', 'c'], 0).ok && !validateSetup(['a', 'b', 'c'], 2).ok && validateSetup(['a', 'b', 'c', 'd', 'e'], 2).ok && !validateSetup(['a', 'b', 'c', 'd', 'e'], 3).ok && !validateSetup(['a', 'b'], 1).ok)

const names = ['Ann', 'Bob', 'Cy', 'Di', 'Ed']
const cfg: Settings = { names, undercover: 1 }
const pair: [string, string] = ['Coffee', 'Tea']

// 4. Assignment.
{
  const g = newGame(cfg, pair, seeded(4))
  check('exactly the configured number are undercover, nobody eliminated, reveal phase', g.roles.filter((r) => r === 'undercover').length === 1 && g.alive.every(Boolean) && g.phase === 'reveal' && g.revealIndex === 0)
  check('words come from the pair, civilians and undercover differ', new Set(g.words).size === 2 && g.words.every((w) => pair.includes(w)))
  check('wordFor maps role to word', names.every((_, i) => wordFor(g, i) === (g.roles[i] === 'civilian' ? g.words[0] : g.words[1])))
  const dist = new Set<number>(); for (let s = 0; s < 60; s++) dist.add(newGame(cfg, pair, seeded(s)).roles.indexOf('undercover'))
  check('assignment is spread across players over many seeds', dist.size === 5)
  const orient = new Set<string>(); for (let s = 0; s < 40; s++) orient.add(newGame(cfg, pair, seeded(s)).words[0])
  check('civilian word is either member of the pair', orient.size === 2)
  const two = newGame({ names: [...names, 'Flo', 'Gus'], undercover: 2 }, pair, seeded(3))
  check('two undercover assigned for 7 players', two.roles.filter((r) => r === 'undercover').length === 2)
}

// helpers
function reveal(g: State): State {
  let s = g
  for (let i = 0; i < g.roles.length; i++) s = must(acknowledgeWord(s, s.seq))
  return s
}
function castAll(g: State, target: (voter: number) => number): State {
  let s = g
  while (s.phase === 'vote') {
    const voter = s.ballot!.voters[s.ballot!.cursor]
    s = must(vote(s, s.seq, target(voter)))
  }
  return s
}
const forceRoles = (g: State, undercoverIdx: number[]): State => ({ ...g, roles: g.roles.map((_, i) => (undercoverIdx.includes(i) ? 'undercover' : 'civilian')) as State['roles'] })

// 5. Reveal -> discuss -> vote -> elimination.
{
  let g = newGame(cfg, pair, seeded(1))
  const first = g.seq
  check('stale or wrong-phase actions rejected', !startVote(g, 0).ok && !vote(g, 0, 1).ok && !acknowledgeWord(g, first + 5).ok)
  for (let i = 0; i < 4; i++) g = must(acknowledgeWord(g, g.seq))
  check('still revealing until everyone has seen their word', g.phase === 'reveal' && g.revealIndex === 4)
  g = must(acknowledgeWord(g, g.seq))
  check('after the last reveal discussion starts, round 1', g.phase === 'discuss' && g.round === 1)
  check('speaking order starts at the starter and covers everyone alive once', discussionOrder(g)[0] === g.starter && discussionOrder(g).length === 5 && new Set(discussionOrder(g)).size === 5)
  check('cannot vote before discussion ends / cannot ack a word now', !vote(g, g.seq, 1).ok && !acknowledgeWord(g, g.seq).ok)
  g = forceRoles(g, [2]) // Cy is undercover
  g = must(startVote(g, g.seq))
  check('ballot has all living players as voters and candidates', g.phase === 'vote' && g.ballot!.voters.join() === '0,1,2,3,4' && g.ballot!.candidates.join() === '0,1,2,3,4')
  check('self vote rejected and does not advance', !vote(g, g.seq, 0).ok && g.ballot!.cursor === 0)
  const dup = vote(g, g.seq, 2)
  check('double tap with the same seq cannot cast two votes', dup.ok && !vote((dup as { state: State }).state, g.seq, 2).ok)
  g = castAll(g, (v) => (v === 2 ? 0 : 2)) // everyone votes Cy, Cy votes Ann
  check('most-voted player is eliminated and result recorded', g.phase === 'tally' && g.result!.kind === 'elected' && (g.result as { player: number }).player === 2 && !g.alive[2])
  check('civilians win when the last undercover is out', g.winner === 'civilians')
  check('cannot continue-voting after tally; continue goes to over', !vote(g, g.seq, 1).ok)
  g = must(continueGame(g, g.seq))
  check('game over, nothing more allowed', g.phase === 'over' && !startVote(g, g.seq).ok && !continueGame(g, g.seq).ok)
}

// 6. Wrong elimination continues; parity gives undercover the win.
{
  let g = reveal(newGame(cfg, pair, seeded(2)))
  g = forceRoles(g, [4]) // Ed undercover; 4 civilians + 1 undercover
  g = must(startVote(g, g.seq))
  g = castAll(g, (v) => (v === 0 ? 1 : 0)) // everyone votes Ann; Ann votes Bob
  check('wrongly eliminating a civilian continues the game (no winner at 3 civilians vs 1)', g.phase === 'tally' && !g.alive[0] && g.winner === null)
  g = must(continueGame(g, g.seq))
  check('next round: round 2, living players only, starter alive', g.phase === 'discuss' && g.round === 2 && g.alive[g.starter] && discussionOrder(g).join().split(',').length === 4)
  g = must(startVote(g, g.seq))
  check('second ballot excludes the eliminated player', g.ballot!.voters.join() === '1,2,3,4' && !g.ballot!.candidates.includes(0))
  g = castAll(g, (v) => (v === 1 ? 2 : 1)) // all vote Bob (1); Bob votes Cy
  check('another civilian out: 2 civilians vs 1 undercover, still going', g.winner === null && g.alive.filter(Boolean).length === 3)
  g = must(continueGame(g, g.seq)); g = must(startVote(g, g.seq))
  g = castAll(g, (v) => (v === 2 ? 3 : 2)) // all vote Cy (2); Cy votes Di
  check('parity (1 civilian vs 1 undercover) is an undercover win', g.winner === 'undercover' && g.alive.filter(Boolean).length === 2)
  g = must(continueGame(g, g.seq))
  check('undercover win ends the game', g.phase === 'over' && g.winner === 'undercover')
}

// 7. Ties: runoff, then no elimination.
{
  // 5 players: votes [1,0,0,1,2] give Ann 2, Bob 2, Cy 1 -> tie between Ann and Bob.
  let g = reveal(newGame(cfg, pair, seeded(5)))
  g = forceRoles(g, [4])
  g = must(startVote(g, g.seq))
  g = castAll(g, (v) => [1, 0, 0, 1, 2][v])
  check('first-round tie leads to a runoff prompt, nobody eliminated yet', g.phase === 'tally' && g.result!.kind === 'tie' && (g.result as { tied: number[] }).tied.join() === '0,1' && g.alive.every(Boolean))
  check('cannot continue past a tie without the runoff', !continueGame(g, g.seq).ok)
  const tied = g
  g = must(startRunoff(g, g.seq))
  check('runoff ballot: everyone votes, only tied players are candidates', g.phase === 'vote' && g.ballot!.round === 2 && g.ballot!.candidates.join() === '0,1' && g.ballot!.voters.length === 5)
  check('a tied voter may only vote for the other tied player', allowedTargets(g.ballot!).join() === '1' && !vote(g, g.seq, 0).ok && !vote(g, g.seq, 2).ok)
  // Runoff votes [1,0,0,1,0]: Ann 3 (from Bob, Cy, Ed), Bob 2 -> Ann eliminated.
  const decided = castAll(g, (v) => [1, 0, 0, 1, 0][v])
  check('runoff with a clear leader eliminates them', decided.phase === 'tally' && decided.result!.kind === 'elected' && (decided.result as { player: number }).player === 0)

  // 4 players: a runoff that ties again eliminates nobody.
  const c4: Settings = { names: ['A', 'B', 'C', 'D'], undercover: 1 }
  let q = forceRoles(reveal(newGame(c4, pair, seeded(7))), [3])
  q = must(startVote(q, q.seq))
  q = castAll(q, (v) => [1, 0, 0, 1][v]) // A:2 (from B,C), B:2 (from A,D)
  check('4 players 2-2 first ballot triggers a runoff', q.result!.kind === 'tie' && (q.result as { tied: number[] }).tied.join() === '0,1')
  q = must(startRunoff(q, q.seq))
  q = castAll(q, (v) => [1, 0, 0, 1][v]) // A: 2 (from B, C), B: 2 (from A, D) -> still tied
  check('second tie eliminates nobody and the game goes on', q.phase === 'tally' && q.result!.kind === 'none' && q.alive.every(Boolean) && q.winner === null)
  q = must(continueGame(q, q.seq))
  check('after a no-elimination round the next round begins with everyone alive', q.phase === 'discuss' && q.round === 2 && q.alive.every(Boolean))
  void tied
}

// 8. Save validation.
{
  const rt = (x: State, c: Settings = cfg) => parseState(JSON.parse(JSON.stringify(x)), c)
  const g0 = newGame(cfg, pair, seeded(8))
  let g = reveal(g0)
  const states: State[] = [g0, g]
  g = forceRoles(g, [1])
  const v0 = must(startVote(g, g.seq)); states.push(v0)
  const v1 = must(vote(v0, v0.seq, 3)); states.push(v1)
  const tally = castAll(v0, (v) => (v === 1 ? 0 : 1)); states.push(tally)
  const over = must(continueGame(tally, tally.seq)); states.push(over)
  check('every phase round-trips (reveal, discuss, vote mid-ballot, tally, over)', states.every((x) => JSON.stringify(rt(x)) === JSON.stringify(x)))
  const t5 = (() => { let q = forceRoles(reveal(newGame(cfg, pair, seeded(5))), [4]); q = must(startVote(q, q.seq)); return castAll(q, (v) => [1, 0, 0, 1, 2][v]) })()
  const runoffAsk = must(startRunoff(t5, t5.seq))
  check('tie tally and runoff vote round-trip', rt(t5) !== null && rt(runoffAsk) !== null)
  const bad = (src: State, mut: (o: Record<string, unknown>) => void) => {
    const o = JSON.parse(JSON.stringify(src)) as Record<string, unknown>
    mut(o)
    return parseState(o, cfg) === null
  }
  check('rejects wrong role counts / identical words / bad alive array', bad(g0, (o) => { (o.roles as string[])[0] = 'undercover'; (o.roles as string[])[1] = 'undercover' }) && bad(g0, (o) => { o.words = ['Tea', 'tea'] }) && bad(g0, (o) => { (o.alive as boolean[]).pop() }))
  check('rejects a winner flag that does not match the board', bad(over, (o) => { o.winner = 'undercover' }) && bad(g, (o) => { o.winner = 'civilians' }))
  check('rejects phase/ballot mismatches', bad(g0, (o) => { o.ballot = JSON.parse(JSON.stringify(v0.ballot)) }) && bad(v0, (o) => { o.ballot = null }) && bad(tally, (o) => { o.result = null }))
  check('rejects a reveal state with a dead player or round > 1', bad(g0, (o) => { (o.alive as boolean[])[0] = false }) && bad(g0, (o) => { o.round = 2 }))
  check('rejects a vote cast for self or by a stranger', bad(v1, (o) => { (o.ballot as { votes: (number | null)[] }).votes[0] = 0 }) && bad(v1, (o) => { (o.ballot as { voters: number[] }).voters = [0, 1, 2, 3, 3] }))
  check('rejects an election result that disagrees with the votes', bad(tally, (o) => { (o.result as { player: number }).player = 3; (o.alive as boolean[])[3] = false; (o.alive as boolean[])[1] = true }))
  check('rejects revealIndex beyond bounds', bad(g0, (o) => { o.revealIndex = 9 }) && bad(g, (o) => { o.revealIndex = 2 }))
  check('rejects junk', parseState(null, cfg) === null && parseState('x', cfg) === null && parseState([], cfg) === null)
  check('settings parse and reject', parseSettings(JSON.parse(JSON.stringify(cfg)))?.undercover === 1 && parseSettings({ ...cfg, undercover: 3 }) === null && parseSettings({ ...cfg, names: ['A', 'a', 'C'] }) === null && parseSettings(null) === null)
  check('aliveIndexes helper', aliveIndexes(tally).join() === '0,2,3,4')
}

console.log(`undercover rules.check: ${checks} checks passed`)
