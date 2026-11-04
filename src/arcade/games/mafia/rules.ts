// Pure Mafia / Werewolf rules (moderator-assisted v1). No React, DOM, storage or network imports.
//
// Variant (documented on the Rules screen): a separate moderator (not a player) holds the device and
// SEES ALL SECRETS. 5-12 players: one Seer, one Doctor, a configurable minority of Mafia, the rest
// Villagers. The moderator passes the device so each player privately sees their role (Mafia also see
// their partners). Each night: the Mafia pick a victim, the Doctor protects one player (self allowed),
// the Seer inspects one player and learns only "Mafia" or "not Mafia"; all choices resolve together
// at dawn: a protected victim does not die. By day there is a secret ballot (one runoff on a tie, a
// second tie eliminates nobody). A dead player's role is revealed and they take no further actions.
// Villagers win when no Mafia remain; the Mafia win at parity (as many as the others combined).

import { type Random, shuffled } from '../../shared/deck.ts'
import { namesAreClean, validateNameList } from '../../shared/names.ts'
import { type Ballot, castVote, isComplete, newBallot, outcome, parseBallot, runoffBallot } from '../../shared/voting.ts'

export const GAME_VERSION = 1
export const MIN_PLAYERS = 5
export const MAX_PLAYERS = 12

export type Role = 'mafia' | 'seer' | 'doctor' | 'villager'
export type Phase = 'assign' | 'night-mafia' | 'night-doctor' | 'night-seer' | 'dawn' | 'day' | 'vote' | 'tally' | 'over'
export type Winner = 'villagers' | 'mafia'

export interface Settings {
  names: string[]
  mafia: number
}

export interface Night {
  kill: number | null
  protect: number | null
  inspect: number | null
  /** True when the inspected player is Mafia. */
  seerSaw: boolean | null
}

export type TallyResult = { kind: 'elected'; player: number } | { kind: 'tie'; tied: number[] } | { kind: 'none' }

export interface Death {
  player: number
  cause: 'night' | 'vote'
}

export interface State {
  roles: Role[]
  alive: boolean[]
  phase: Phase
  /** Next player to privately view their role (assign phase). */
  assignIndex: number
  /** 0 during assignment, then 1, 2, ... */
  nightNumber: number
  night: Night
  /** The death announced at dawn (or null: nobody died). */
  death: Death | null
  ballot: Ballot | null
  result: TallyResult | null
  winner: Winner | null
  seq: number
}

export type Result<T> = { ok: true; state: T } | { ok: false; reason: string }
const reject = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })

const emptyNight = (): Night => ({ kill: null, protect: null, inspect: null, seerSaw: null })

/** Non-Mafia must outnumber Mafia at setup, and at least one plain Villager must exist. */
export const maxMafia = (players: number) => Math.max(0, Math.min(Math.floor((players - 1) / 2), players - 3))
export const defaultMafia = (players: number) => Math.max(1, Math.round(players / 4))

export interface SetupCheck {
  ok: boolean
  names: string[]
  errors: (string | null)[]
  mafiaError: string | null
}

export function validateSetup(rawNames: readonly string[], mafia: number): SetupCheck {
  const names = validateNameList(rawNames, MIN_PLAYERS, MAX_PLAYERS)
  const max = maxMafia(rawNames.length)
  let mafiaError: string | null = null
  if (!Number.isInteger(mafia) || mafia < 1) mafiaError = 'Need at least one Mafia player.'
  else if (mafia > max) mafiaError = `With ${rawNames.length} players at most ${max} can be Mafia.`
  return { ok: names.ok && mafiaError === null, names: names.names, errors: names.errors, mafiaError }
}

export const aliveIndexes = (s: State): number[] => s.alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0)
export const indexOfRole = (s: State, role: Role): number => s.roles.indexOf(role)
export const roleAlive = (s: State, role: Role): boolean => s.roles.some((r, i) => r === role && s.alive[i])
export const mafiaPartners = (s: State, player: number): number[] => s.roles.map((r, i) => (r === 'mafia' && i !== player ? i : -1)).filter((i) => i >= 0)

function winnerOf(roles: readonly Role[], alive: readonly boolean[]): Winner | null {
  const mafia = roles.filter((r, i) => alive[i] && r === 'mafia').length
  const others = roles.filter((r, i) => alive[i] && r !== 'mafia').length
  if (mafia === 0) return 'villagers'
  return mafia >= others ? 'mafia' : null
}

export function newGame(settings: Settings, random: Random): State {
  const n = settings.names.length
  const order = shuffled(n, random)
  const roles: Role[] = Array<Role>(n).fill('villager')
  roles[order[0]] = 'seer'
  roles[order[1]] = 'doctor'
  for (const i of order.slice(2, 2 + settings.mafia)) roles[i] = 'mafia'
  return { roles, alive: Array<boolean>(n).fill(true), phase: 'assign', assignIndex: 0, nightNumber: 0, night: emptyNight(), death: null, ballot: null, result: null, winner: null, seq: 0 }
}

const bump = (s: State, patch: Partial<State>): State => ({ ...s, ...patch, seq: s.seq + 1 })

/** The player on screen has seen their role and passed the device back. */
export function acknowledgeRole(s: State, seq: number): Result<State> {
  if (seq !== s.seq) return reject('stale')
  if (s.phase !== 'assign') return reject('not-assigning')
  const next = s.assignIndex + 1
  return { ok: true, state: bump(s, next >= s.roles.length ? { assignIndex: next, phase: 'night-mafia', nightNumber: 1, night: emptyNight() } : { assignIndex: next }) }
}

/** Mafia victim: a living player who is not Mafia. */
export function chooseVictim(s: State, seq: number, target: number): Result<State> {
  if (seq !== s.seq) return reject('stale')
  if (s.phase !== 'night-mafia') return reject('not-mafia-turn')
  if (!Number.isInteger(target) || target < 0 || target >= s.roles.length || !s.alive[target]) return reject('target-not-alive')
  if (s.roles[target] === 'mafia') return reject('cannot-target-mafia')
  return { ok: true, state: bump(s, { phase: 'night-doctor', night: { ...s.night, kill: target } }) }
}

/** Doctor protection (self allowed). A dead Doctor takes no action: the moderator passes with `null`. */
export function protect(s: State, seq: number, target: number | null): Result<State> {
  if (seq !== s.seq) return reject('stale')
  if (s.phase !== 'night-doctor') return reject('not-doctor-turn')
  const doctorAlive = roleAlive(s, 'doctor')
  if (!doctorAlive) {
    if (target !== null) return reject('doctor-is-dead')
  } else {
    if (target === null) return reject('doctor-must-choose')
    if (!Number.isInteger(target) || target < 0 || target >= s.roles.length || !s.alive[target]) return reject('target-not-alive')
  }
  return { ok: true, state: bump(s, { phase: 'night-seer', night: { ...s.night, protect: target } }) }
}

/** Seer inspection: learns only whether the target is Mafia. A dead Seer takes no action (`null`). */
export function inspect(s: State, seq: number, target: number | null): Result<State> {
  if (seq !== s.seq) return reject('stale')
  if (s.phase !== 'night-seer') return reject('not-seer-turn')
  if (s.night.inspect !== null) return reject('already-inspected')
  const seerAlive = roleAlive(s, 'seer')
  if (!seerAlive) {
    if (target !== null) return reject('seer-is-dead')
    return { ok: true, state: bump(s, { night: { ...s.night, inspect: null, seerSaw: null } }) }
  }
  if (target === null) return reject('seer-must-choose')
  if (!Number.isInteger(target) || target < 0 || target >= s.roles.length || !s.alive[target]) return reject('target-not-alive')
  if (s.roles[target] === 'seer') return reject('cannot-inspect-self')
  return { ok: true, state: bump(s, { night: { ...s.night, inspect: target, seerSaw: s.roles[target] === 'mafia' } }) }
}

/** Resolve the night simultaneously: a protected victim survives. */
export function resolveNight(s: State, seq: number): Result<State> {
  if (seq !== s.seq) return reject('stale')
  if (s.phase !== 'night-seer') return reject('not-seer-turn')
  if (roleAlive(s, 'seer') && s.night.inspect === null) return reject('seer-has-not-inspected')
  const kill = s.night.kill!
  const saved = s.night.protect === kill
  const alive = s.alive.slice()
  let death: Death | null = null
  if (!saved) {
    alive[kill] = false
    death = { player: kill, cause: 'night' }
  }
  return { ok: true, state: bump(s, { phase: 'dawn', alive, death, winner: winnerOf(s.roles, alive) }) }
}

export function startDay(s: State, seq: number): Result<State> {
  if (seq !== s.seq) return reject('stale')
  if (s.phase !== 'dawn') return reject('not-dawn')
  return { ok: true, state: bump(s, { phase: s.winner ? 'over' : 'day' }) }
}

export function startVote(s: State, seq: number): Result<State> {
  if (seq !== s.seq) return reject('stale')
  if (s.phase !== 'day') return reject('not-day')
  const alive = aliveIndexes(s)
  return { ok: true, state: bump(s, { phase: 'vote', ballot: newBallot(alive, alive, 1), result: null }) }
}

export function vote(s: State, seq: number, target: number): Result<State> {
  if (seq !== s.seq) return reject('stale')
  if (s.phase !== 'vote' || !s.ballot) return reject('not-voting')
  const cast = castVote(s.ballot, target)
  if (!cast.ok) return reject(cast.reason)
  const ballot = cast.ballot
  if (!isComplete(ballot)) return { ok: true, state: bump(s, { ballot }) }
  const out = outcome(ballot)
  if (out.kind === 'elected') {
    const alive = s.alive.slice()
    alive[out.player] = false
    return { ok: true, state: bump(s, { ballot, alive, phase: 'tally', result: { kind: 'elected', player: out.player }, death: { player: out.player, cause: 'vote' }, winner: winnerOf(s.roles, alive) }) }
  }
  return { ok: true, state: bump(s, { ballot, phase: 'tally', result: ballot.round === 1 ? { kind: 'tie', tied: out.tied } : { kind: 'none' } }) }
}

export function startRunoff(s: State, seq: number): Result<State> {
  if (seq !== s.seq) return reject('stale')
  if (s.phase !== 'tally' || !s.ballot || s.result?.kind !== 'tie') return reject('no-tie')
  return { ok: true, state: bump(s, { phase: 'vote', ballot: runoffBallot(s.ballot, s.result.tied), result: null }) }
}

/** After the tally: the next night, or the final result. */
export function continueGame(s: State, seq: number): Result<State> {
  if (seq !== s.seq) return reject('stale')
  if (s.phase !== 'tally' || !s.result) return reject('not-tally')
  if (s.result.kind === 'tie') return reject('runoff-required')
  if (s.winner) return { ok: true, state: bump(s, { phase: 'over' }) }
  return { ok: true, state: bump(s, { phase: 'night-mafia', nightNumber: s.nightNumber + 1, night: emptyNight(), death: null, ballot: null, result: null }) }
}

// ---- Save validation ------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown, max = 100000): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max

export function parseSettings(raw: unknown): Settings | null {
  if (!isObj(raw) || !namesAreClean(raw.names, MIN_PLAYERS, MAX_PLAYERS)) return null
  const check = validateSetup(raw.names, raw.mafia as number)
  return check.ok ? { names: raw.names, mafia: raw.mafia as number } : null
}

export function parseState(raw: unknown, settings: Settings): State | null {
  if (!isObj(raw)) return null
  const n = settings.names.length
  const { roles, alive, phase, assignIndex, nightNumber, night, death, ballot, result, winner, seq } = raw
  if (!Array.isArray(roles) || roles.length !== n || !roles.every((r) => r === 'mafia' || r === 'seer' || r === 'doctor' || r === 'villager')) return null
  const rl = roles as Role[]
  const count = (r: Role) => rl.filter((x) => x === r).length
  if (count('mafia') !== settings.mafia || count('seer') !== 1 || count('doctor') !== 1) return null
  if (!Array.isArray(alive) || alive.length !== n || !alive.every((a) => typeof a === 'boolean')) return null
  const al = alive as boolean[]
  const phases: Phase[] = ['assign', 'night-mafia', 'night-doctor', 'night-seer', 'dawn', 'day', 'vote', 'tally', 'over']
  if (typeof phase !== 'string' || !phases.includes(phase as Phase)) return null
  const ph = phase as Phase
  if (!isCount(assignIndex, 100) || !isCount(nightNumber, 1000) || !isCount(seq)) return null
  if (!isObj(night)) return null
  const idx = (v: unknown) => v === null || (isCount(v, n))
  if (!idx(night.kill) || !idx(night.protect) || !idx(night.inspect)) return null
  if (night.seerSaw !== null && typeof night.seerSaw !== 'boolean') return null
  const nt: Night = { kill: night.kill as number | null, protect: night.protect as number | null, inspect: night.inspect as number | null, seerSaw: night.seerSaw as boolean | null }

  const computed = winnerOf(rl, al)
  if (winner !== computed) return null
  if (ph === 'over' && computed === null) return null

  if (ph === 'assign') {
    if (assignIndex >= n || nightNumber !== 0 || al.some((a) => !a) || nt.kill !== null || nt.protect !== null || nt.inspect !== null || nt.seerSaw !== null || death !== null || ballot !== null || result !== null) return null
  } else {
    if (assignIndex !== n || nightNumber < 1) return null
  }

  const seerIdx = rl.indexOf('seer')
  const doctorIdx = rl.indexOf('doctor')
  if (ph === 'night-mafia') {
    if (nt.kill !== null || nt.protect !== null || nt.inspect !== null || nt.seerSaw !== null || death !== null) return null
  }
  if (ph === 'night-doctor' || ph === 'night-seer' || ph === 'dawn') {
    if (nt.kill === null || !al[nt.kill] && ph !== 'dawn' || rl[nt.kill] === 'mafia') return null
  }
  if (ph === 'night-doctor' && (nt.protect !== null || nt.inspect !== null || nt.seerSaw !== null)) return null
  if (ph === 'night-seer' || ph === 'dawn') {
    if (al[doctorIdx] || ph === 'night-seer') {
      // Doctor alive at night => a protection was chosen; dead doctor => none.
      if (ph === 'night-seer' && (al[doctorIdx] ? nt.protect === null || !al[nt.protect] : nt.protect !== null)) return null
    }
    if ((nt.inspect === null) !== (nt.seerSaw === null)) return null
    if (nt.inspect !== null && (nt.inspect === seerIdx || nt.seerSaw !== (rl[nt.inspect] === 'mafia'))) return null
  }
  if (ph === 'dawn') {
    // The announced death must follow from the night's choices.
    const d = death
    const killed = nt.kill!
    if (d === null) {
      if (nt.protect !== killed || !al[killed]) return null
    } else {
      if (!isObj(d) || d.player !== killed || d.cause !== 'night' || al[killed] || nt.protect === killed) return null
    }
  }

  let b: Ballot | null = null
  if (ballot !== null) {
    b = parseBallot(ballot, n)
    if (!b) return null
    const aliveSet = al.map((a, i) => (a ? i : -1)).filter((i) => i >= 0)
    const eliminated = isObj(result) && result.kind === 'elected' ? (result.player as number) : null
    const expected = eliminated === null ? aliveSet : [...aliveSet, eliminated].sort((x, y) => x - y)
    if (b.voters.slice().sort((x, y) => x - y).join() !== expected.join()) return null
    if (b.round === 1 && b.candidates.slice().sort((x, y) => x - y).join() !== expected.join()) return null
    if (b.round === 2 && b.candidates.some((c) => !expected.includes(c))) return null
  }

  let res: TallyResult | null = null
  if (result !== null) {
    if (!isObj(result)) return null
    if (result.kind === 'elected') {
      if (!isCount(result.player, n) || al[result.player]) return null
      res = { kind: 'elected', player: result.player }
    } else if (result.kind === 'tie') {
      if (!Array.isArray(result.tied) || result.tied.length < 2 || !result.tied.every((p) => isCount(p, n))) return null
      res = { kind: 'tie', tied: result.tied as number[] }
    } else if (result.kind === 'none') res = { kind: 'none' }
    else return null
  }

  let dth: Death | null = null
  if (death !== null) {
    if (!isObj(death) || !isCount(death.player, n) || (death.cause !== 'night' && death.cause !== 'vote') || al[death.player]) return null
    dth = { player: death.player, cause: death.cause }
  }

  if (ph === 'vote') {
    if (!b || isComplete(b) || res !== null) return null
  } else if (ph === 'tally') {
    if (!b || !isComplete(b) || !res) return null
    const o = outcome(b)
    if (res.kind === 'elected' && !(o.kind === 'elected' && o.player === res.player && dth?.player === res.player && dth.cause === 'vote')) return null
    if (res.kind === 'tie' && !(o.kind === 'tie' && b.round === 1 && o.tied.join() === res.tied.join())) return null
    if (res.kind === 'none' && !(o.kind === 'tie' && b.round === 2)) return null
  } else if (b !== null || res !== null) {
    if (!(ph === 'over' && b && res)) return null
  }

  return { roles: rl, alive: al, phase: ph, assignIndex, nightNumber, night: nt, death: dth, ballot: b, result: res, winner: computed, seq }
}
