// Pure team-round machine shared by Word Rush and Charades.
// One team plays a timed turn at a time: correct = +1, pass = 0. Cards come from a no-repeat
// deck over a frozen pool. Clock and randomness are injected. Every action is idempotent
// against double taps via a card token. No React, DOM, storage or network imports.

import { type Deck, type Random, draw, newDeck, parseDeck } from './deck.ts'
import { type Timer, idleTimer, isExpired, parseTimer, pause, resume, startTimer } from './timer.ts'

export const MIN_POOL = 10
export const TURNS_OPTIONS = [1, 2, 3] as const
export const SECONDS_OPTIONS = [30, 60, 90] as const
export const MAX_TEAM_NAME = 14

export interface RoundSettings {
  teams: string[] // 2..4 distinct names
  turnsPerTeam: number
  turnSeconds: number
  categoryIds: string[]
}

export type Phase = 'ready' | 'playing' | 'paused' | 'summary' | 'over'

export interface RoundState {
  poolSize: number
  deck: Deck
  scores: number[]
  /** 0-based global turn; team = turn % teams. */
  turn: number
  phase: Phase
  timer: Timer
  /** Pool index of the card on screen (playing/paused only). */
  card: number | null
  correct: number[]
  passed: number[]
  /** Card on screen when time ran out (consumed, not scored). */
  skipped: number[]
}

export type Result<T> = { ok: true; state: T } | { ok: false; reason: string }

export const teamOf = (s: RoundState, teamCount: number) => s.turn % teamCount
export const totalTurns = (settings: RoundSettings) => settings.teams.length * settings.turnsPerTeam
/** Monotonic token for the card on screen; actions must present the token they rendered. */
export const cardToken = (s: RoundState) => s.deck.reshuffles * (s.poolSize + 1) + s.deck.cursor

export function newRounds(settings: RoundSettings, poolSize: number, random: Random): RoundState {
  return {
    poolSize,
    deck: newDeck(poolSize, random),
    scores: settings.teams.map(() => 0),
    turn: 0,
    phase: 'ready',
    timer: idleTimer(settings.turnSeconds * 1000),
    card: null,
    correct: [],
    passed: [],
    skipped: [],
  }
}

export function startTurn(state: RoundState, settings: RoundSettings, now: number, random: Random): Result<RoundState> {
  if (state.phase !== 'ready') return { ok: false, reason: 'not-ready' }
  const d = draw(state.deck, state.poolSize, random, null)
  if (d.index === null) return { ok: false, reason: 'empty-pool' }
  return { ok: true, state: { ...state, phase: 'playing', deck: d.deck, card: d.index, timer: startTimer(settings.turnSeconds * 1000, now) } }
}

function answer(state: RoundState, token: number, now: number, random: Random, scored: boolean, teamCount: number): Result<RoundState> {
  if (state.phase !== 'playing' || state.card === null) return { ok: false, reason: 'not-playing' }
  if (isExpired(state.timer, now)) return { ok: false, reason: 'expired' }
  if (token !== cardToken(state)) return { ok: false, reason: 'stale-card' }
  const d = draw(state.deck, state.poolSize, random, state.card)
  const scores = state.scores.slice()
  if (scored) scores[teamOf(state, teamCount)] += 1
  return {
    ok: true,
    state: {
      ...state,
      deck: d.deck,
      card: d.index,
      scores,
      correct: scored ? [...state.correct, state.card] : state.correct,
      passed: scored ? state.passed : [...state.passed, state.card],
    },
  }
}

export const markCorrect = (s: RoundState, settings: RoundSettings, token: number, now: number, random: Random) =>
  answer(s, token, now, random, true, settings.teams.length)
export const markPass = (s: RoundState, settings: RoundSettings, token: number, now: number, random: Random) =>
  answer(s, token, now, random, false, settings.teams.length)

/** Ends the turn when the deadline has passed (also after the page slept). Returns the same state otherwise. */
export function reconcile(state: RoundState, now: number): RoundState {
  if (state.phase !== 'playing' || !isExpired(state.timer, now)) return state
  return {
    ...state,
    phase: 'summary',
    timer: idleTimer(0),
    skipped: state.card === null ? state.skipped : [...state.skipped, state.card],
    card: null,
  }
}

export function pauseTurn(state: RoundState, now: number): Result<RoundState> {
  if (state.phase !== 'playing') return { ok: false, reason: 'not-playing' }
  if (isExpired(state.timer, now)) return { ok: false, reason: 'expired' }
  return { ok: true, state: { ...state, phase: 'paused', timer: pause(state.timer, now) } }
}

export function resumeTurn(state: RoundState, now: number): Result<RoundState> {
  if (state.phase !== 'paused') return { ok: false, reason: 'not-paused' }
  return { ok: true, state: { ...state, phase: 'playing', timer: resume(state.timer, now) } }
}

/** From the turn summary to the next team's ready screen, or to the final result. */
export function nextTurn(state: RoundState, settings: RoundSettings): Result<RoundState> {
  if (state.phase !== 'summary') return { ok: false, reason: 'not-summary' }
  const base = { ...state, card: null, correct: [], passed: [], skipped: [], timer: idleTimer(settings.turnSeconds * 1000) }
  if (state.turn + 1 >= totalTurns(settings)) return { ok: true, state: { ...base, phase: 'over' } }
  return { ok: true, state: { ...base, phase: 'ready', turn: state.turn + 1 } }
}

export interface Ranked {
  team: number
  score: number
  rank: number // 1-based, ties share a rank
}

export function ranking(scores: readonly number[]): Ranked[] {
  const sorted = scores.map((score, team) => ({ team, score })).sort((a, b) => b.score - a.score || a.team - b.team)
  return sorted.map((r, i) => ({ ...r, rank: i > 0 && sorted[i - 1].score === r.score ? 0 : i + 1 })).reduce<Ranked[]>((acc, r) => {
    acc.push({ ...r, rank: r.rank === 0 ? acc[acc.length - 1].rank : r.rank })
    return acc
  }, [])
}

// ---- Setup validation -----------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

export interface TeamNameCheck {
  ok: boolean
  names: string[]
  errors: (string | null)[]
}

export function validateTeamNames(raw: readonly string[]): TeamNameCheck {
  const names = raw.map(clean)
  const errors: (string | null)[] = names.map((n) => {
    if (n.length === 0) return 'Enter a name.'
    if (n.length > MAX_TEAM_NAME) return `Use ${MAX_TEAM_NAME} characters or fewer.`
    if (CONTROL.test(n)) return 'Remove special characters.'
    return null
  })
  names.forEach((n, i) => {
    if (errors[i] === null && names.findIndex((m) => m.toLowerCase() === n.toLowerCase()) !== i) errors[i] = 'Names must be different.'
  })
  if (names.length < 2 || names.length > 4) return { ok: false, names, errors: errors.map((e) => e ?? 'Use 2 to 4 teams.') }
  return { ok: errors.every((e) => e === null), names, errors }
}

// ---- Save validation ------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 100000

export function parseRoundSettings(raw: unknown, knownCategories: readonly string[]): RoundSettings | null {
  if (!isObj(raw) || !Array.isArray(raw.teams) || !Array.isArray(raw.categoryIds)) return null
  const teams: unknown[] = raw.teams
  if (!teams.every((t) => typeof t === 'string')) return null
  const check = validateTeamNames(teams as string[])
  if (!check.ok || check.names.some((n, i) => n !== teams[i])) return null
  if (!(TURNS_OPTIONS as readonly unknown[]).includes(raw.turnsPerTeam)) return null
  if (!(SECONDS_OPTIONS as readonly unknown[]).includes(raw.turnSeconds)) return null
  const ids = raw.categoryIds
  if (ids.length === 0 || !ids.every((c) => typeof c === 'string' && knownCategories.includes(c)) || new Set(ids).size !== ids.length) return null
  return { teams: check.names, turnsPerTeam: raw.turnsPerTeam as number, turnSeconds: raw.turnSeconds as number, categoryIds: ids as string[] }
}

const indexList = (v: unknown, size: number): number[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < size) ? (v as number[]) : null

export function parseRoundState(raw: unknown, settings: RoundSettings, poolSize: number): RoundState | null {
  if (!isObj(raw) || raw.poolSize !== poolSize || poolSize < MIN_POOL) return null
  const deck = parseDeck(raw.deck, poolSize)
  const timer = parseTimer(raw.timer, settings.turnSeconds * 1000)
  const correct = indexList(raw.correct, poolSize)
  const passed = indexList(raw.passed, poolSize)
  const skipped = indexList(raw.skipped, poolSize)
  const { scores, turn, phase, card } = raw
  if (!deck || !timer || !correct || !passed || !skipped) return null
  if (!Array.isArray(scores) || scores.length !== settings.teams.length || !scores.every(isCount)) return null
  if (!isCount(turn) || turn >= totalTurns(settings)) return null
  if (phase !== 'ready' && phase !== 'playing' && phase !== 'paused' && phase !== 'summary' && phase !== 'over') return null
  if (card !== null && !(typeof card === 'number' && Number.isInteger(card) && card >= 0 && card < poolSize)) return null

  const live = phase === 'playing' || phase === 'paused'
  if (live !== (card !== null)) return null
  if (phase === 'playing' && timer.endsAt === null) return null
  if (phase !== 'playing' && timer.endsAt !== null) return null
  if (phase === 'ready' && (correct.length || passed.length || skipped.length)) return null
  if (phase === 'over' && turn !== totalTurns(settings) - 1) return null
  const seen = [...correct, ...passed, ...skipped, ...(card === null ? [] : [card])]
  if (phase !== 'summary' && skipped.length > 0) return null
  if (deck.cursor + deck.reshuffles * poolSize < seen.length) return null

  return { poolSize, deck, scores: scores as number[], turn, phase, timer, card: card as number | null, correct, passed, skipped }
}
