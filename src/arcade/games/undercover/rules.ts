// Pure Undercover rules. No React, DOM, storage or network imports.
//
// Variant (documented on the Rules screen): 3-10 players share one device. Most players are
// civilians and get the same secret word; a configurable minority (always fewer than half) are
// undercover and get a related but different word. There is no Mr White. Everyone privately sees
// their word once, then rounds of discussion (in a stated speaking order) and a secret ballot.
// The most-voted player is eliminated and their role is revealed. A tie goes to one runoff among
// the tied players; a second tie eliminates nobody. Civilians win when no undercover remains;
// the undercover win when they are at least as many as the civilians still alive (parity).

import { type Random, shuffled } from '../../shared/deck.ts'
import { type Ballot, castVote, isComplete, newBallot, outcome, parseBallot, runoffBallot } from '../../shared/voting.ts'
import { namesAreClean, validateNameList } from '../../shared/names.ts'

export const GAME_VERSION = 1
export const MIN_PLAYERS = 3
export const MAX_PLAYERS = 10

export type Role = 'civilian' | 'undercover'
export type Phase = 'reveal' | 'discuss' | 'vote' | 'tally' | 'over'
export type Winner = 'civilians' | 'undercover'

export interface Settings {
  names: string[]
  undercover: number
}

export type TallyResult =
  | { kind: 'elected'; player: number }
  | { kind: 'tie'; tied: number[] }
  | { kind: 'none' }

export interface State {
  roles: Role[]
  /** [civilianWord, undercoverWord] */
  words: [string, string]
  alive: boolean[]
  phase: Phase
  /** Player about to privately view their word (reveal phase) or players done (== n afterwards). */
  revealIndex: number
  round: number
  /** Who speaks first this round. */
  starter: number
  ballot: Ballot | null
  result: TallyResult | null
  winner: Winner | null
  seq: number
}

export type Result<T> = { ok: true; state: T } | { ok: false; reason: string }
const reject = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })

/** Civilians must stay a strict majority at setup: undercover < half the players. */
export const maxUndercover = (players: number) => Math.floor((players - 1) / 2)
export const defaultUndercover = (players: number) => (players >= 7 ? 2 : 1)

export interface SetupCheck {
  ok: boolean
  names: string[]
  errors: (string | null)[]
  undercoverError: string | null
}

export function validateSetup(rawNames: readonly string[], undercover: number): SetupCheck {
  const names = validateNameList(rawNames, MIN_PLAYERS, MAX_PLAYERS)
  const max = maxUndercover(rawNames.length)
  let undercoverError: string | null = null
  if (!Number.isInteger(undercover) || undercover < 1) undercoverError = 'Need at least one undercover player.'
  else if (undercover > max) undercoverError = `With ${rawNames.length} players at most ${max} can be undercover (civilians must be the majority).`
  return { ok: names.ok && undercoverError === null, names: names.names, errors: names.errors, undercoverError }
}

export const aliveIndexes = (s: State): number[] => s.alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0)
export const wordFor = (s: State, player: number): string => (s.roles[player] === 'civilian' ? s.words[0] : s.words[1])

function winnerOf(roles: readonly Role[], alive: readonly boolean[]): Winner | null {
  const und = roles.filter((r, i) => alive[i] && r === 'undercover').length
  const civ = roles.filter((r, i) => alive[i] && r === 'civilian').length
  if (und === 0) return 'civilians'
  return und >= civ ? 'undercover' : null
}

/** Speaking order for the round: living players starting from `starter`, wrapping around. */
export function discussionOrder(s: State): number[] {
  const n = s.alive.length
  const out: number[] = []
  for (let k = 0; k < n; k++) {
    const p = (s.starter + k) % n
    if (s.alive[p]) out.push(p)
  }
  return out
}

export function newGame(settings: Settings, pair: readonly [string, string], random: Random): State {
  const n = settings.names.length
  const order = shuffled(n, random)
  const roles: Role[] = Array<Role>(n).fill('civilian')
  for (const i of order.slice(0, settings.undercover)) roles[i] = 'undercover'
  const words: [string, string] = random() < 0.5 ? [pair[0], pair[1]] : [pair[1], pair[0]]
  return {
    roles,
    words,
    alive: Array<boolean>(n).fill(true),
    phase: 'reveal',
    revealIndex: 0,
    round: 1,
    starter: Math.min(n - 1, Math.floor(random() * n)),
    ballot: null,
    result: null,
    winner: null,
    seq: 0,
  }
}

const bump = (s: State, patch: Partial<State>): State => ({ ...s, ...patch, seq: s.seq + 1 })

/** The player on screen has seen their word and passed the device on. */
export function acknowledgeWord(s: State, seq: number): Result<State> {
  if (seq !== s.seq) return reject('stale')
  if (s.phase !== 'reveal') return reject('not-revealing')
  const next = s.revealIndex + 1
  return { ok: true, state: bump(s, next >= s.roles.length ? { phase: 'discuss', revealIndex: next } : { revealIndex: next }) }
}

export function startVote(s: State, seq: number): Result<State> {
  if (seq !== s.seq) return reject('stale')
  if (s.phase !== 'discuss') return reject('not-discussing')
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
    return { ok: true, state: bump(s, { ballot, alive, phase: 'tally', result: { kind: 'elected', player: out.player }, winner: winnerOf(s.roles, alive) }) }
  }
  const result: TallyResult = ballot.round === 1 ? { kind: 'tie', tied: out.tied } : { kind: 'none' }
  return { ok: true, state: bump(s, { ballot, phase: 'tally', result }) }
}

export function startRunoff(s: State, seq: number): Result<State> {
  if (seq !== s.seq) return reject('stale')
  if (s.phase !== 'tally' || !s.ballot || s.result?.kind !== 'tie') return reject('no-tie')
  return { ok: true, state: bump(s, { phase: 'vote', ballot: runoffBallot(s.ballot, s.result.tied), result: null }) }
}

/** From the tally to the next round of discussion, or to the final result. */
export function continueGame(s: State, seq: number): Result<State> {
  if (seq !== s.seq) return reject('stale')
  if (s.phase !== 'tally' || !s.result) return reject('not-tally')
  if (s.result.kind === 'tie') return reject('runoff-required')
  if (s.winner) return { ok: true, state: bump(s, { phase: 'over' }) }
  const n = s.alive.length
  let starter = s.starter
  for (let k = 1; k <= n; k++) {
    const p = (s.starter + k) % n
    if (s.alive[p]) {
      starter = p
      break
    }
  }
  return { ok: true, state: bump(s, { phase: 'discuss', round: s.round + 1, starter, ballot: null, result: null }) }
}

// ---- Save validation ------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown, max = 100000): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max

export function parseSettings(raw: unknown): Settings | null {
  if (!isObj(raw) || !namesAreClean(raw.names, MIN_PLAYERS, MAX_PLAYERS)) return null
  const check = validateSetup(raw.names, raw.undercover as number)
  return check.ok ? { names: raw.names, undercover: raw.undercover as number } : null
}

export function parseState(raw: unknown, settings: Settings): State | null {
  if (!isObj(raw)) return null
  const n = settings.names.length
  const { roles, words, alive, phase, revealIndex, round, starter, ballot, result, winner, seq } = raw
  if (!Array.isArray(roles) || roles.length !== n || !roles.every((r) => r === 'civilian' || r === 'undercover')) return null
  if ((roles as Role[]).filter((r) => r === 'undercover').length !== settings.undercover) return null
  if (!Array.isArray(words) || words.length !== 2 || !words.every((w) => typeof w === 'string' && w.length > 0 && w.length <= 14)) return null
  if (words[0].toLowerCase() === words[1].toLowerCase()) return null
  if (!Array.isArray(alive) || alive.length !== n || !alive.every((a) => typeof a === 'boolean')) return null
  if (phase !== 'reveal' && phase !== 'discuss' && phase !== 'vote' && phase !== 'tally' && phase !== 'over') return null
  if (!isCount(revealIndex, 100) || !isCount(round, 1000) || round < 1 || !isCount(starter, n) || !isCount(seq)) return null
  const al = alive as boolean[]
  const rl = roles as Role[]

  const computed = winnerOf(rl, al)
  if (winner !== computed) return null
  if (phase === 'over' && computed === null) return null

  if (phase === 'reveal') {
    if (revealIndex >= n || al.some((a) => !a) || round !== 1 || ballot !== null || result !== null) return null
  } else if (revealIndex !== n) return null
  if ((phase === 'reveal' || phase === 'discuss' || phase === 'vote') && !al[starter]) return null

  let b: Ballot | null = null
  if (ballot !== null) {
    b = parseBallot(ballot, n)
    if (!b) return null
    const aliveSet = al.map((a, i) => (a ? i : -1)).filter((i) => i >= 0)
    // Voters are the players alive when the ballot started: alive now, or the one just eliminated by it.
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

  if (phase === 'vote') {
    if (!b || isComplete(b) || res !== null) return null
  } else if (phase === 'tally') {
    if (!b || !isComplete(b) || !res) return null
    const o = outcome(b)
    if (res.kind === 'elected' && !(o.kind === 'elected' && o.player === res.player)) return null
    if (res.kind === 'tie' && !(o.kind === 'tie' && b.round === 1 && o.tied.join() === res.tied.join())) return null
    if (res.kind === 'none' && !(o.kind === 'tie' && b.round === 2)) return null
  } else if (b !== null || res !== null) {
    // discuss / over / reveal carry no ballot; 'over' may keep the final result for display.
    if (!(phase === 'over' && b && res)) return null
  }

  return { roles: rl, words: [words[0], words[1]] as [string, string], alive: al, phase, revealIndex, round, starter, ballot: b, result: res, winner: computed, seq }
}
