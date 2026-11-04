// Pure Trivia Battle rules. No React, DOM, storage or network imports.
//
// Variant (documented on the Rules screen):
// - Individuals (2-6) or teams (2-4, each with 1-5 members). Teams share one device; the answering
//   member rotates per team, so unequal team sizes are fine (each team gets the same number of questions).
// - Format "choice": the answerer picks one of four shuffled options; the pick locks, then the correct
//   answer and explanation are shown. Format "host": a quizmaster reads the question, deliberately
//   reveals the answer, then awards correct or incorrect exactly once. No speed scoring either way.
// - Each correct answer scores `points` (1-3). Everyone gets `rounds` questions in turn.
// - Tie for the lead: the tied players/teams may each play one extra question per cycle, repeating until
//   one leads, or share the win. If the shuffled bank cannot cover a cycle the win is shared.
// The match freezes a shuffled order of question ids and a shuffled option order per question, so
// answers map correctly after a reload. Every action carries the `seq` the screen rendered, so double
// taps and stale screens are rejected.

import { type Random, shuffled } from '../../shared/deck.ts'

export const GAME_VERSION = 1
export const ROUNDS_OPTIONS = [2, 3, 5] as const
export const POINTS_OPTIONS = [1, 2, 3] as const
export const MAX_NAME = 14
export const MAX_PLAYERS = 6
export const MAX_TEAMS = 4
export const MAX_MEMBERS = 5

export type Mode = 'players' | 'teams'
export type Format = 'choice' | 'host'
export type Phase = 'ready' | 'question' | 'reveal' | 'tie' | 'over'

export interface Entrant {
  name: string
  /** Team members (teams mode); empty for individual players. */
  members: string[]
}

export interface Settings {
  mode: Mode
  entrants: Entrant[]
  format: Format
  /** Questions per player/team in regulation. */
  rounds: number
  /** Points per correct answer. */
  points: number
  categoryIds: string[]
}

export interface Current {
  /** Index into `order` of the question on screen. */
  q: number
  /** Option id picked (0 = the correct option). Choice format only. */
  chosen: number | null
  /** Host format: the quizmaster has revealed the answer. */
  answerShown: boolean
  /** Result once resolved. */
  correct: boolean | null
}

export interface TieState {
  cycle: number
  /** Participants still level at the top. */
  ids: number[]
  /** Who still has to answer in the running tie-break cycle. */
  queue: number[]
}

export interface State {
  packVersion: number
  /** Frozen shuffled question ids for the whole match (regulation and tie-breaks draw from the front). */
  order: string[]
  /** Frozen option order per question: a permutation of [0,1,2,3] (0 is the correct option). */
  optionOrders: number[][]
  cursor: number
  scores: number[]
  /** Questions each participant has answered (drives member rotation). */
  answered: number[]
  turn: number
  phase: Phase
  seq: number
  participant: number
  current: Current | null
  tie: TieState | null
  /** Set when the match ends with a shared win. */
  shared: number[] | null
}

export type Result<T> = { ok: true; state: T } | { ok: false; reason: string }

const reject = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })
export const totalTurns = (s: Settings) => s.entrants.length * s.rounds
export const remainingQuestions = (st: State) => st.order.length - st.cursor

/** Minimum questions needed to start. */
export const questionsNeeded = (s: { entrants: readonly unknown[]; rounds: number }) => s.entrants.length * s.rounds

/** The member answering now (teams mode) or null. */
export function answererOf(st: State, settings: Settings): string | null {
  const e = settings.entrants[st.participant]
  return e.members.length === 0 ? null : e.members[st.answered[st.participant] % e.members.length]
}

export function newMatch(settings: Settings, poolIds: readonly string[], version: number, random: Random): State {
  const order = shuffled(poolIds.length, random).map((i) => poolIds[i])
  return {
    packVersion: version,
    order,
    optionOrders: order.map(() => shuffled(4, random)),
    cursor: 0,
    scores: settings.entrants.map(() => 0),
    answered: settings.entrants.map(() => 0),
    turn: 0,
    phase: 'ready',
    seq: 0,
    participant: 0,
    current: null,
    tie: null,
    shared: null,
  }
}

const bump = (st: State, patch: Partial<State>): State => ({ ...st, ...patch, seq: st.seq + 1 })

export function showQuestion(st: State, seq: number): Result<State> {
  if (seq !== st.seq) return reject('stale')
  if (st.phase !== 'ready') return reject('not-ready')
  if (st.cursor >= st.order.length) return reject('no-questions-left')
  return { ok: true, state: bump(st, { phase: 'question', cursor: st.cursor + 1, current: { q: st.cursor, chosen: null, answerShown: false, correct: null } }) }
}

function resolve(st: State, settings: Settings, correct: boolean, patch: Partial<Current>): State {
  const scores = st.scores.slice()
  if (correct) scores[st.participant] += settings.points
  const answered = st.answered.slice()
  answered[st.participant] += 1
  return bump(st, { phase: 'reveal', scores, answered, current: { ...st.current!, ...patch, correct } })
}

/** Choice format: lock the answerer's pick (a display position 0-3). */
export function choose(st: State, settings: Settings, seq: number, position: number): Result<State> {
  if (seq !== st.seq) return reject('stale')
  if (settings.format !== 'choice') return reject('wrong-format')
  if (st.phase !== 'question' || !st.current) return reject('not-asking')
  if (st.current.chosen !== null) return reject('already-answered')
  if (!Number.isInteger(position) || position < 0 || position > 3) return reject('out-of-range')
  const optionId = st.optionOrders[st.current.q][position]
  return { ok: true, state: resolve(st, settings, optionId === 0, { chosen: optionId }) }
}

/** Host format: the quizmaster deliberately reveals the answer to themselves. */
export function revealAnswer(st: State, settings: Settings, seq: number): Result<State> {
  if (seq !== st.seq) return reject('stale')
  if (settings.format !== 'host') return reject('wrong-format')
  if (st.phase !== 'question' || !st.current) return reject('not-asking')
  if (st.current.answerShown) return reject('already-revealed')
  return { ok: true, state: bump(st, { current: { ...st.current, answerShown: true } }) }
}

/** Host format: award the turn once, after the answer has been revealed. */
export function award(st: State, settings: Settings, seq: number, correct: boolean): Result<State> {
  if (seq !== st.seq) return reject('stale')
  if (settings.format !== 'host') return reject('wrong-format')
  if (st.phase !== 'question' || !st.current) return reject('not-asking')
  if (!st.current.answerShown) return reject('answer-not-revealed')
  if (st.current.correct !== null) return reject('already-awarded')
  return { ok: true, state: resolve(st, settings, correct, {}) }
}

function leaders(scores: readonly number[], among: readonly number[]): number[] {
  const top = Math.max(...among.map((i) => scores[i]))
  return among.filter((i) => scores[i] === top)
}

/** After regulation or a tie-break cycle: decide, or ask about a (further) tie-break. */
function settle(st: State, among: number[]): State {
  const lead = leaders(st.scores, among)
  if (lead.length === 1) return bump(st, { phase: 'over', current: null, tie: null, shared: null })
  // Not enough questions left to give every tied side one more: the win is shared.
  if (remainingQuestions(st) < lead.length) return bump(st, { phase: 'over', current: null, tie: null, shared: lead })
  return bump(st, { phase: 'tie', current: null, tie: { cycle: st.tie ? st.tie.cycle : 0, ids: lead, queue: [] } })
}

export function nextTurn(st: State, settings: Settings, seq: number): Result<State> {
  if (seq !== st.seq) return reject('stale')
  if (st.phase !== 'reveal') return reject('not-revealed')
  const n = settings.entrants.length
  const total = totalTurns(settings)

  if (st.tie === null) {
    const turn = st.turn + 1
    if (turn >= total) return { ok: true, state: settle({ ...st, turn: total }, Array.from({ length: n }, (_, i) => i)) }
    return { ok: true, state: bump(st, { turn, participant: turn % n, phase: 'ready', current: null }) }
  }

  const queue = st.tie.queue.slice(1)
  if (queue.length > 0) {
    return { ok: true, state: bump(st, { tie: { ...st.tie, queue }, participant: queue[0], phase: 'ready', current: null }) }
  }
  return { ok: true, state: settle(st, st.tie.ids) }
}

export function startTieBreak(st: State, seq: number): Result<State> {
  if (seq !== st.seq) return reject('stale')
  if (st.phase !== 'tie' || !st.tie) return reject('no-tie')
  if (remainingQuestions(st) < st.tie.ids.length) return reject('bank-exhausted')
  const queue = [...st.tie.ids]
  return { ok: true, state: bump(st, { phase: 'ready', current: null, participant: queue[0], tie: { cycle: st.tie.cycle + 1, ids: st.tie.ids, queue } }) }
}

export function declineTieBreak(st: State, seq: number): Result<State> {
  if (seq !== st.seq) return reject('stale')
  if (st.phase !== 'tie' || !st.tie) return reject('no-tie')
  return { ok: true, state: bump(st, { phase: 'over', tie: null, current: null, shared: [...st.tie.ids] }) }
}

/** Indexes that won: the shared winners, or the single top scorer. */
export function winners(st: State): number[] {
  if (st.shared) return st.shared
  const top = Math.max(...st.scores)
  return st.scores.map((s, i) => (s === top ? i : -1)).filter((i) => i >= 0)
}

// ---- Setup validation -----------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

export interface EntrantCheck {
  ok: boolean
  entrants: Entrant[]
  errors: (string | null)[]
}

/** Parses a comma-separated member list. */
export const splitMembers = (text: string): string[] => text.split(',').map(clean).filter((m) => m.length > 0)

function nameError(n: string): string | null {
  if (n.length === 0) return 'Enter a name.'
  if (n.length > MAX_NAME) return `Use ${MAX_NAME} characters or fewer.`
  if (CONTROL.test(n)) return 'Remove special characters.'
  return null
}

export function validateEntrants(mode: Mode, raw: readonly { name: string; members: string }[]): EntrantCheck {
  const max = mode === 'players' ? MAX_PLAYERS : MAX_TEAMS
  const entrants: Entrant[] = raw.map((r) => ({ name: clean(r.name), members: mode === 'teams' ? splitMembers(r.members) : [] }))
  const errors: (string | null)[] = entrants.map((e) => nameError(e.name))
  entrants.forEach((e, i) => {
    if (errors[i] === null && entrants.findIndex((o) => o.name.toLowerCase() === e.name.toLowerCase()) !== i) errors[i] = 'Names must be different.'
    if (errors[i] === null && mode === 'teams') {
      if (e.members.length === 0) errors[i] = 'Add at least one member (comma separated).'
      else if (e.members.length > MAX_MEMBERS) errors[i] = `Use ${MAX_MEMBERS} members or fewer.`
      else {
        const bad = e.members.map(nameError).find((x) => x !== null)
        if (bad) errors[i] = `Member name: ${bad}`
        else if (new Set(e.members.map((m) => m.toLowerCase())).size !== e.members.length) errors[i] = 'Member names must be different.'
      }
    }
  })
  if (entrants.length < 2 || entrants.length > max) {
    return { ok: false, entrants, errors: errors.map((e) => e ?? `Use 2 to ${max} ${mode === 'players' ? 'players' : 'teams'}.`) }
  }
  return { ok: errors.every((e) => e === null), entrants, errors }
}

// ---- Save validation ------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown, max = 100000): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max

export function parseSettings(raw: unknown, knownCategories: readonly string[]): Settings | null {
  if (!isObj(raw)) return null
  if (raw.mode !== 'players' && raw.mode !== 'teams') return null
  if (raw.format !== 'choice' && raw.format !== 'host') return null
  if (!(ROUNDS_OPTIONS as readonly unknown[]).includes(raw.rounds)) return null
  if (!(POINTS_OPTIONS as readonly unknown[]).includes(raw.points)) return null
  if (!Array.isArray(raw.entrants) || !Array.isArray(raw.categoryIds)) return null
  const ids = raw.categoryIds
  if (ids.length === 0 || new Set(ids).size !== ids.length || !ids.every((c) => typeof c === 'string' && knownCategories.includes(c))) return null
  const input: { name: string; members: string }[] = []
  for (const e of raw.entrants as unknown[]) {
    if (!isObj(e) || typeof e.name !== 'string' || !Array.isArray(e.members) || !e.members.every((m) => typeof m === 'string')) return null
    input.push({ name: e.name, members: (e.members as string[]).join(',') })
  }
  if (raw.mode === 'players' && (raw.entrants as { members: unknown[] }[]).some((e) => e.members.length !== 0)) return null
  const check = validateEntrants(raw.mode, input)
  if (!check.ok) return null
  // Stored names must already be in cleaned form.
  const stored = raw.entrants as { name: string; members: string[] }[]
  if (check.entrants.some((e, i) => e.name !== stored[i].name || e.members.join('\u0000') !== stored[i].members.join('\u0000'))) return null
  return { mode: raw.mode, entrants: check.entrants, format: raw.format, rounds: raw.rounds as number, points: raw.points as number, categoryIds: ids as string[] }
}

const isPermutation = (v: unknown, size: number): v is number[] =>
  Array.isArray(v) && v.length === size && new Set(v).size === size && v.every((x) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < size)

/** `poolIds` are the ids of the selected categories' questions in the current bank. */
export function parseState(raw: unknown, settings: Settings, poolIds: readonly string[], version: number): State | null {
  if (!isObj(raw) || raw.packVersion !== version) return null
  const { order, optionOrders, cursor, scores, answered, turn, phase, seq, participant, current, tie, shared } = raw
  if (!Array.isArray(order) || order.length !== poolIds.length || !order.every((id) => typeof id === 'string')) return null
  const poolSet = new Set(poolIds)
  if (new Set(order).size !== order.length || !order.every((id) => poolSet.has(id as string))) return null
  if (!Array.isArray(optionOrders) || optionOrders.length !== order.length || !optionOrders.every((o) => isPermutation(o, 4))) return null
  const n = settings.entrants.length
  const total = totalTurns(settings)
  if (!isCount(cursor) || cursor > order.length) return null
  if (!Array.isArray(scores) || scores.length !== n || !scores.every((s) => isCount(s))) return null
  if (!Array.isArray(answered) || answered.length !== n || !answered.every((s) => isCount(s))) return null
  if (!isCount(turn) || turn > total || !isCount(seq) || !isCount(participant) || participant >= n) return null
  if (phase !== 'ready' && phase !== 'question' && phase !== 'reveal' && phase !== 'tie' && phase !== 'over') return null

  // Scores are whole multiples of the point value and cannot exceed what was asked.
  if (!scores.every((s) => (s as number) % settings.points === 0)) return null
  if ((scores as number[]).reduce((a, b) => a + b, 0) > settings.points * cursor) return null

  // Current question.
  let cur: Current | null = null
  const live = phase === 'question' || phase === 'reveal'
  if (live !== (current !== null)) return null
  if (current !== null) {
    if (!isObj(current) || current.q !== cursor - 1 || cursor < 1) return null
    const { chosen, answerShown, correct } = current
    if (chosen !== null && !(typeof chosen === 'number' && Number.isInteger(chosen) && chosen >= 0 && chosen <= 3)) return null
    if (typeof answerShown !== 'boolean' || (correct !== null && typeof correct !== 'boolean')) return null
    if (phase === 'question') {
      if (chosen !== null || correct !== null) return null
      if (settings.format === 'choice' && answerShown) return null
    } else {
      if (correct === null) return null
      if (settings.format === 'choice' && (chosen === null || correct !== (chosen === 0))) return null
      if (settings.format === 'host' && (chosen !== null || !answerShown)) return null
    }
    cur = { q: current.q as number, chosen: chosen as number | null, answerShown, correct: correct as boolean | null }
  }
  // Every question drawn has been resolved, except the one on screen.
  if ((answered as number[]).reduce((a, b) => a + b, 0) !== cursor - (phase === 'question' ? 1 : 0)) return null

  // Tie-break bookkeeping.
  let tieState: TieState | null = null
  if (tie !== null) {
    if (!isObj(tie) || !isCount(tie.cycle) || !Array.isArray(tie.ids) || !Array.isArray(tie.queue)) return null
    const ids = tie.ids as unknown[]
    const queue = tie.queue as unknown[]
    const okIndex = (x: unknown) => isCount(x) && x < n
    if (ids.length < 2 || !ids.every(okIndex) || new Set(ids).size !== ids.length) return null
    if (!queue.every(okIndex) || !queue.every((x) => ids.includes(x))) return null
    tieState = { cycle: tie.cycle as number, ids: ids as number[], queue: queue as number[] }
  }
  if (tieState !== null) {
    if (turn !== total || phase === 'over') return null
    if (phase === 'tie' ? tieState.queue.length !== 0 : tieState.queue.length === 0 || tieState.queue[0] !== participant) return null
    const top = Math.max(...scores)
    if (phase === 'tie' && !tieState.ids.every((i) => scores[i] === scores[tieState!.ids[0]])) return null
    if (phase === 'tie' && scores[tieState.ids[0]] !== top) return null
  } else if (phase === 'tie') {
    return null
  } else if (phase !== 'over') {
    if (turn >= total || participant !== turn % n) return null
  } else if (turn !== total) {
    return null
  }
  if (phase === 'tie' && remainingQuestions({ order, cursor } as State) < (tieState?.ids.length ?? 0)) return null

  // Shared win.
  let sharedIds: number[] | null = null
  if (shared !== null) {
    if (phase !== 'over' || !Array.isArray(shared) || shared.length < 2 || new Set(shared).size !== shared.length || !shared.every((x) => isCount(x) && (x as number) < n)) return null
    const top = Math.max(...scores)
    if (!shared.every((i) => scores[i as number] === scores[shared[0] as number])) return null
    if (scores[shared[0] as number] !== top) return null
    sharedIds = shared as number[]
  }
  if (phase === 'over' && sharedIds === null) {
    // A decided match has a single top scorer.
    const top = Math.max(...scores)
    if ((scores as number[]).filter((s) => s === top).length !== 1) return null
  }

  return {
    packVersion: version,
    order: order as string[],
    optionOrders: optionOrders as number[][],
    cursor,
    scores: scores as number[],
    answered: answered as number[],
    turn,
    phase,
    seq,
    participant,
    current: cur,
    tie: tieState,
    shared: sharedIds,
  }
}
