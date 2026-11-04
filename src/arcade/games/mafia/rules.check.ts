// Focused deterministic checks for Mafia / Werewolf rules.
// Run:  node src/arcade/games/mafia/rules.check.ts   (non-zero exit on failure)
import type { Random } from '../../shared/deck.ts'
import {
  acknowledgeRole, aliveIndexes, chooseVictim, continueGame, defaultMafia, inspect, mafiaPartners, maxMafia, newGame, parseSettings, parseState,
  protect, resolveNight, startDay, startRunoff, startVote, validateSetup, vote, type Role, type Settings, type State,
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
const rejected = (r: { ok: boolean; reason?: string }, why?: string) => !r.ok && (why === undefined || r.reason === why)

// 1. Setup.
check('mafia limits keep the others in the majority with a plain villager left', [5, 6, 7, 8, 9, 10, 11, 12].map(maxMafia).join() === '2,2,3,3,4,4,5,5' && defaultMafia(5) === 1 && defaultMafia(8) === 2 && defaultMafia(12) === 3)
const names = ['Ann', 'Bob', 'Cy', 'Di', 'Ed', 'Flo', 'Gus']
check('setup validation: 5-12 players, at least one Mafia, minority only', validateSetup(names.slice(0, 5), 1).ok && !validateSetup(names.slice(0, 4), 1).ok && !validateSetup(names.slice(0, 5), 0).ok && !validateSetup(names.slice(0, 5), 3).ok && validateSetup(names, 3).ok && !validateSetup(names, 4).ok && !validateSetup(['a', 'A', 'c', 'd', 'e'], 1).ok && !validateSetup([...names, 'h', 'i', 'j', 'k', 'l', 'm'], 3).ok)

const cfg: Settings = { names, mafia: 2 }
function rolesOf(s: State): Record<Role, number[]> {
  const out: Record<Role, number[]> = { mafia: [], seer: [], doctor: [], villager: [] }
  s.roles.forEach((r, i) => out[r].push(i))
  return out
}

// 2. Assignment.
{
  const g = newGame(cfg, seeded(3))
  const r = rolesOf(g)
  check('one Seer, one Doctor, configured Mafia, rest Villagers', r.seer.length === 1 && r.doctor.length === 1 && r.mafia.length === 2 && r.villager.length === 3)
  check('starts in assignment, everyone alive, nobody has acted', g.phase === 'assign' && g.assignIndex === 0 && g.alive.every(Boolean) && g.night.kill === null)
  const seerSpots = new Set<number>(), mafiaSpots = new Set<number>()
  for (let s = 0; s < 80; s++) { const x = rolesOf(newGame(cfg, seeded(s))); seerSpots.add(x.seer[0]); x.mafia.forEach((m) => mafiaSpots.add(m)) }
  check('roles are spread over many seeds', seerSpots.size === 7 && mafiaSpots.size === 7)
  check('mafia partners exclude the player themselves', (() => { const m = r.mafia[0]; return mafiaPartners(g, m).join() === String(r.mafia[1]) && mafiaPartners(g, r.villager[0]).join() === r.mafia.join() })())
}

// Fixtures with known roles: 0 Ann=mafia, 1 Bob=mafia, 2 Cy=seer, 3 Di=doctor, 4 Ed/5 Flo/6 Gus villagers.
const fixed = (alive?: boolean[]): State => ({ ...newGame(cfg, seeded(1)), roles: ['mafia', 'mafia', 'seer', 'doctor', 'villager', 'villager', 'villager'], alive: alive ?? Array(7).fill(true), assignIndex: 7, phase: 'night-mafia', nightNumber: 1 })

// 3. Role assignment hand-offs.
{
  let g = newGame(cfg, seeded(2))
  check('stale / out-of-phase actions rejected during assignment', rejected(chooseVictim(g, g.seq, 4)) && rejected(acknowledgeRole(g, 9)) && rejected(startVote(g, g.seq)))
  for (let i = 0; i < 6; i++) g = must(acknowledgeRole(g, g.seq))
  check('still assigning until everyone has seen their role', g.phase === 'assign' && g.assignIndex === 6)
  g = must(acknowledgeRole(g, g.seq))
  check('after the last role the first night begins', g.phase === 'night-mafia' && g.nightNumber === 1)
}

// 4. Night: kill, protect, inspect, resolve.
{
  let g = fixed()
  check('Mafia cannot target a Mafia partner or a dead/invalid player', rejected(chooseVictim(g, g.seq, 1), 'cannot-target-mafia') && rejected(chooseVictim(g, g.seq, 0)) && rejected(chooseVictim(g, g.seq, 9)) && rejected(chooseVictim(fixed(Array(7).fill(true).map((_, i) => i !== 4)), 0, 4), 'target-not-alive'))
  check('doctor action not allowed before the Mafia choose', rejected(protect(g, g.seq, 4)) && rejected(inspect(g, g.seq, 4)) && rejected(resolveNight(g, g.seq)))
  g = must(chooseVictim(g, g.seq, 4))
  check('Mafia choice recorded, now the Doctor', g.phase === 'night-doctor' && g.night.kill === 4)
  check('stale seq rejected, double-tap cannot choose twice', rejected(chooseVictim(g, 0, 5)) && rejected(chooseVictim(g, g.seq, 5)))
  check('Doctor must choose a living player while alive', rejected(protect(g, g.seq, null), 'doctor-must-choose') && rejected(protect(g, g.seq, 9)))
  const protectedState = must(protect(g, g.seq, 4))
  check('Doctor may protect any living player', protectedState.phase === 'night-seer' && protectedState.night.protect === 4)
  check('Doctor may protect themselves', must(protect(g, g.seq, 3)).night.protect === 3)
  g = must(protect(g, g.seq, 5))
  check('Seer must inspect before the night resolves', rejected(resolveNight(g, g.seq), 'seer-has-not-inspected'))
  check('Seer cannot inspect themselves or a dead/invalid player', rejected(inspect(g, g.seq, 2), 'cannot-inspect-self') && rejected(inspect(g, g.seq, 9)) && rejected(inspect(g, g.seq, null), 'seer-must-choose'))
  const sawMafia = must(inspect(g, g.seq, 0))
  const sawNot = must(inspect(g, g.seq, 6))
  check('Seer learns only Mafia / not Mafia', sawMafia.night.seerSaw === true && sawNot.night.seerSaw === false && sawNot.night.inspect === 6)
  check('Seer cannot inspect twice', rejected(inspect(sawMafia, sawMafia.seq, 1), 'already-inspected'))
  const dawn = must(resolveNight(sawNot, sawNot.seq))
  check('unprotected victim dies at dawn, with the death recorded', dawn.phase === 'dawn' && !dawn.alive[4] && dawn.death!.player === 4 && dawn.death!.cause === 'night')
}
// Protected victim survives; simultaneous resolution.
{
  let g = fixed()
  g = must(chooseVictim(g, g.seq, 4)); g = must(protect(g, g.seq, 4)); g = must(inspect(g, g.seq, 0))
  const dawn = must(resolveNight(g, g.seq))
  check('a protected victim does not die: nobody died', dawn.alive.every(Boolean) && dawn.death === null && dawn.winner === null)
  const day = must(startDay(dawn, dawn.seq))
  check('then day begins', day.phase === 'day')
  // The Doctor protecting themselves while the Mafia target the Doctor: they survive.
  let h = fixed()
  h = must(chooseVictim(h, h.seq, 3)); h = must(protect(h, h.seq, 3)); h = must(inspect(h, h.seq, 6))
  check('self-protection saves the Doctor from a Mafia attack', must(resolveNight(h, h.seq)).alive[3])
  // Mafia kill the Doctor who protects someone else: Doctor dies.
  let k = fixed()
  k = must(chooseVictim(k, k.seq, 3)); k = must(protect(k, k.seq, 5)); k = must(inspect(k, k.seq, 6))
  check('Doctor protecting someone else can still be killed', !must(resolveNight(k, k.seq)).alive[3])
}

// 5. Dead players take no actions.
{
  // Doctor already dead: moderator passes with null; a protection is rejected.
  const noDoc = fixed(Array(7).fill(true).map((_, i) => i !== 3))
  let g = must(chooseVictim(noDoc, noDoc.seq, 4))
  check('dead Doctor cannot protect anyone (moderator passes)', rejected(protect(g, g.seq, 5), 'doctor-is-dead') && must(protect(g, g.seq, null)).phase === 'night-seer')
  g = must(protect(g, g.seq, null))
  check('with a living Seer the moderator still needs an inspection', rejected(resolveNight(g, g.seq)))
  // Seer dead: pass with null; an inspection is rejected.
  const noSeer = fixed(Array(7).fill(true).map((_, i) => i !== 2))
  let s = must(protect(must(chooseVictim(noSeer, noSeer.seq, 4)), 1, 5))
  check('dead Seer cannot inspect', rejected(inspect(s, s.seq, 6), 'seer-is-dead'))
  s = must(inspect(s, s.seq, null))
  check('dead Seer passes and the night can resolve', s.night.inspect === null && must(resolveNight(s, s.seq)).phase === 'dawn')
  // Dead players cannot be targeted or vote.
  const someDead = fixed([true, true, true, true, false, true, true])
  check('cannot target a dead player at night', rejected(chooseVictim(someDead, someDead.seq, 4), 'target-not-alive'))
  const day = { ...someDead, phase: 'day' as const }
  const v = must(startVote(day, day.seq))
  check('ballot voters and candidates are living players only', v.ballot!.voters.join() === '0,1,2,3,5,6' && !v.ballot!.candidates.includes(4))
}

// 6. Day vote: elimination, role is public (via state), ties.
function ballotAll(g: State, targetOf: (voter: number) => number): State {
  let s = g
  while (s.phase === 'vote') s = must(vote(s, s.seq, targetOf(s.ballot!.voters[s.ballot!.cursor])))
  return s
}
const dayState = (roles?: Role[]): State => ({ ...fixed(), phase: 'day', roles: roles ?? fixed().roles })
{
  let g = must(startVote(dayState(), 0))
  check('self-vote rejected', rejected(vote(g, g.seq, 0), 'self-vote'))
  g = ballotAll(g, (v) => (v === 6 ? 5 : 6)) // everyone votes Gus (a villager), Gus votes Flo
  check('most-voted player is eliminated at day', g.phase === 'tally' && !g.alive[6] && g.death!.player === 6 && g.death!.cause === 'vote' && g.winner === null)
  g = must(continueGame(g, g.seq))
  check('game continues to the next night with fresh night state', g.phase === 'night-mafia' && g.nightNumber === 2 && g.night.kill === null && g.death === null && g.ballot === null)
}
{
  // Tie -> runoff -> still tied -> nobody eliminated.
  // Six living players (Gus is dead).
  const six: State = { ...dayState(), alive: [true, true, true, true, true, true, false], roles: ['mafia', 'mafia', 'seer', 'doctor', 'villager', 'villager', 'villager'] }
  let t = must(startVote(six, 0))
  t = ballotAll(t, (v) => [1, 0, 0, 1, 0, 1][v]) // voters 0..5: Ann gets from 1,2,4 = 3, Bob from 0,3,5 = 3
  check('first-round tie asks for a runoff, nobody dies yet', t.phase === 'tally' && t.result!.kind === 'tie' && (t.result as { tied: number[] }).tied.join() === '0,1' && t.alive.filter(Boolean).length === 6)
  check('cannot continue to night without the runoff', rejected(continueGame(t, t.seq), 'runoff-required'))
  let r = must(startRunoff(t, t.seq))
  r = ballotAll(r, (v) => [1, 0, 0, 1, 0, 1][v])
  check('a second tie eliminates nobody', r.phase === 'tally' && r.result!.kind === 'none' && r.alive.filter(Boolean).length === 6 && r.winner === null)
  r = must(continueGame(r, r.seq))
  check('then night falls again', r.phase === 'night-mafia' && r.nightNumber === 2)
  let r2 = must(startRunoff(t, t.seq))
  r2 = ballotAll(r2, (v) => [1, 0, 0, 0, 0, 0][v]) // Ann gets 5? voters 0..5 -> Bob:1(from 0), Ann:5 -> Ann elected
  check('a runoff with a leader eliminates them (a Mafia member here)', r2.result!.kind === 'elected' && (r2.result as { player: number }).player === 0 && r2.roles[0] === 'mafia' && !r2.alive[0])
}

// 7. Win conditions.
{
  // Villagers win when the last Mafia is voted out.
  const oneMafia: State = { ...dayState(), roles: ['mafia', 'villager', 'seer', 'doctor', 'villager', 'villager', 'villager'] }
  let g = must(startVote(oneMafia, 0))
  g = ballotAll(g, (v) => (v === 0 ? 1 : 0))
  check('voting out the last Mafia is a villager win', g.winner === 'villagers' && g.phase === 'tally')
  g = must(continueGame(g, g.seq))
  check('villager win ends the game', g.phase === 'over' && !startVote(g, g.seq).ok)
  // Mafia win at parity at dawn: 2 mafia vs 2 others after the kill.
  const parity: State = { ...fixed(), alive: [true, true, true, true, false, false, false] } // 2 mafia, seer, doctor alive
  let n = must(chooseVictim(parity, parity.seq, 2)); n = must(protect(n, n.seq, 3)); n = must(inspect(n, n.seq, 0))
  const dawn = must(resolveNight(n, n.seq))
  check('Mafia at parity (2 vs 2) win at dawn', dawn.winner === 'mafia' && dawn.phase === 'dawn')
  check('dawn with a winner goes to the end, not to a day', must(startDay(dawn, dawn.seq)).phase === 'over')
  // Mafia win at parity by a day mistake.
  const edge: State = { ...dayState(), alive: [true, true, false, false, true, true, true] } // mafia 2, others 3
  let e = must(startVote(edge, 0))
  e = ballotAll(e, (v) => (v === 4 ? 5 : 4)) // eliminate Ed (villager) -> 2 mafia vs 2 others
  check('a wrong elimination to parity gives the Mafia the win', e.winner === 'mafia')
  check('villagers still ahead after one more civilian dies is not yet a Mafia win (3 others vs 1 mafia)', (() => { const x: State = { ...dayState(), roles: ['mafia', 'villager', 'seer', 'doctor', 'villager', 'villager', 'villager'] }; let y = must(startVote(x, 0)); y = ballotAll(y, (v) => (v === 6 ? 5 : 6)); return y.winner === null })())
}

// 8. A full scripted game end-to-end.
{
  let g = newGame(cfg, seeded(11))
  for (let i = 0; i < 7; i++) g = must(acknowledgeRole(g, g.seq))
  const r = rolesOf(g)
  let guard = 0
  while (g.phase !== 'over' && guard++ < 40) {
    if (g.phase === 'night-mafia') { const t = aliveIndexes(g).find((i) => g.roles[i] !== 'mafia')!; g = must(chooseVictim(g, g.seq, t)) }
    else if (g.phase === 'night-doctor') g = must(protect(g, g.seq, aliveIndexes(g).includes(r.doctor[0]) ? aliveIndexes(g)[0] : null))
    else if (g.phase === 'night-seer') { if (g.night.inspect === null) { const t = aliveIndexes(g).find((i) => i !== r.seer[0])!; g = must(inspect(g, g.seq, g.alive[r.seer[0]] ? t : null)) } else g = must(resolveNight(g, g.seq)) }
    else if (g.phase === 'dawn') g = must(startDay(g, g.seq))
    else if (g.phase === 'day') g = must(startVote(g, g.seq))
    else if (g.phase === 'vote') g = ballotAll(g, (v) => aliveIndexes(g).find((i) => i !== v && g.roles[i] === 'mafia') ?? aliveIndexes(g).find((i) => i !== v)!)
    else if (g.phase === 'tally') g = g.result!.kind === 'tie' ? must(startRunoff(g, g.seq)) : must(continueGame(g, g.seq))
  }
  check('a whole game reaches a valid ending', g.phase === 'over' && g.winner !== null)
}

// 9. Save validation.
{
  const rt = (x: State, c: Settings = cfg) => parseState(JSON.parse(JSON.stringify(x)), c)
  const states: State[] = []
  let g = newGame(cfg, seeded(6)); states.push(g)
  g = fixed(); states.push(g)
  g = must(chooseVictim(g, g.seq, 4)); states.push(g)
  g = must(protect(g, g.seq, 5)); states.push(g)
  g = must(inspect(g, g.seq, 0)); states.push(g)
  const dawn = must(resolveNight(g, g.seq)); states.push(dawn)
  const day = must(startDay(dawn, dawn.seq)); states.push(day)
  const vote0 = must(startVote(day, day.seq)); states.push(vote0)
  const vote1 = must(vote(vote0, vote0.seq, 1)); states.push(vote1)
  const tally = ballotAll(vote0, (v) => (v === 6 ? 5 : 6)); states.push(tally)
  check('every phase round-trips (assign, each night step, dawn, day, vote, tally)', states.every((x) => JSON.stringify(rt(x)) === JSON.stringify(x)))
  const savedNight = (() => { let x = fixed(); x = must(chooseVictim(x, x.seq, 4)); x = must(protect(x, x.seq, 4)); x = must(inspect(x, x.seq, 0)); return must(resolveNight(x, x.seq)) })()
  check('dawn with nobody dead round-trips', rt(savedNight) !== null && savedNight.death === null)
  const bad = (src: State, mut: (o: Record<string, unknown>) => void) => {
    const o = JSON.parse(JSON.stringify(src)) as Record<string, unknown>
    mut(o)
    return parseState(o, cfg) === null
  }
  check('rejects wrong role composition', bad(day, (o) => { (o.roles as string[])[2] = 'villager' }) && bad(day, (o) => { (o.roles as string[])[4] = 'mafia' }) && bad(day, (o) => { (o.roles as string[]).pop() }))
  check('rejects a Mafia victim, an unrecorded kill, or night data that does not fit the phase', bad(g, (o) => { (o.night as { kill: number }).kill = 1 }) && bad(states[2], (o) => { (o.night as { protect: number }).protect = 5 }) && bad(states[1], (o) => { (o.night as { kill: number }).kill = 4 }))
  check('rejects a seer result that disagrees with the target', bad(g, (o) => { (o.night as { seerSaw: boolean }).seerSaw = false }) && bad(g, (o) => { (o.night as { inspect: number }).inspect = 2 }))
  check('rejects a dawn that does not follow from the night', bad(dawn, (o) => { o.death = null }) && bad(savedNight, (o) => { o.death = { player: 4, cause: 'night' } }) && bad(dawn, (o) => { (o.alive as boolean[])[4] = true }))
  check('rejects a winner flag that is wrong', bad(day, (o) => { o.winner = 'mafia' }) && bad(dawn, (o) => { o.winner = 'villagers' }))
  check('rejects phase/ballot mismatches', bad(day, (o) => { o.ballot = JSON.parse(JSON.stringify(vote0.ballot)) }) && bad(vote0, (o) => { o.ballot = null }) && bad(tally, (o) => { o.result = null }))
  check('rejects an assign state past the end or with a dead player', bad(states[0], (o) => { o.assignIndex = 7 }) && bad(states[0], (o) => { (o.alive as boolean[])[0] = false }) && bad(states[0], (o) => { o.nightNumber = 1 }))
  check('rejects bad votes', bad(vote1, (o) => { (o.ballot as { votes: (number | null)[] }).votes[0] = 0 }) && bad(vote1, (o) => { (o.ballot as { cursor: number }).cursor = 5 }))
  check('rejects junk', parseState(null, cfg) === null && parseState('x', cfg) === null && parseState([], cfg) === null)
  check('settings parse / reject', parseSettings(JSON.parse(JSON.stringify(cfg)))?.mafia === 2 && parseSettings({ ...cfg, mafia: 4 }) === null && parseSettings({ ...cfg, mafia: 0 }) === null && parseSettings(null) === null)
}

console.log(`mafia rules.check: ${checks} checks passed`)
