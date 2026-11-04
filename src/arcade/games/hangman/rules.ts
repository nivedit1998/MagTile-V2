// Pure Hangman rules. No React, DOM, storage or network imports.
//
// Variant (documented on the Rules screen): two players alternate as guesser. Words are folded
// to upper-case A-Z (diacritics removed). Spaces and - ' . are shown from the start. Repeated
// guesses are ignored. The guesser has a fixed number of wrong guesses. Scoring: a solved
// word scores 1 for the guesser; in custom-word rounds a failed word scores 1 for the setter.
// Random words come from a no-repeat deck over the chosen categories.

import { type Deck, type Random, draw, newDeck, parseDeck } from '../../shared/deck.ts'

export const GAME_VERSION = 1
export const LIMIT_OPTIONS = [5, 6, 8] as const
export const MAX_WORD_LENGTH = 24
export const MAX_NAME_LENGTH = 14
export const MIN_POOL = 10

export type Mode = 'random' | 'custom'
export type Limit = (typeof LIMIT_OPTIONS)[number]
export type Phase = 'word' | 'play' | 'result'
export type Player = 0 | 1

export interface Settings {
  names: [string, string]
  mode: Mode
  limit: Limit
  /** Categories for random mode (empty for custom). */
  categoryIds: string[]
}

export interface State {
  scores: [number, number]
  round: number
  guesser: Player
  phase: Phase
  /** Normalised word; null only while a custom word is still to be entered. */
  word: string | null
  guessed: string[]
  /** Random mode only. */
  deck: Deck | null
}

export type Result<T> = { ok: true; state: T } | { ok: false; reason: string }

export const other = (p: Player): Player => (p === 0 ? 1 : 0)
export const setterOf = (s: State): Player => other(s.guesser)

// ---- Words ----------------------------------------------------------------

const ALLOWED = /^[A-Z '.\-]+$/

export type WordCheck = { ok: true; word: string } | { ok: false; error: string }

/** Folds input to the stored form or explains why it cannot be used. */
export function normalizeWord(input: string): WordCheck {
  const folded = input
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[‘’]/g, "'")
    .toLocaleUpperCase('en')
    .replace(/\s+/g, ' ')
    .trim()
  if (folded.length === 0) return { ok: false, error: 'Enter a word or phrase.' }
  if (folded.length > MAX_WORD_LENGTH) return { ok: false, error: `Use ${MAX_WORD_LENGTH} characters or fewer.` }
  if (!ALLOWED.test(folded)) return { ok: false, error: "Use letters, spaces, hyphens, apostrophes and periods only." }
  if (letterSet(folded).length < 2) return { ok: false, error: 'Use at least two different letters.' }
  return { ok: true, word: folded }
}

export const isLetter = (ch: string) => ch.length === 1 && ch >= 'A' && ch <= 'Z'

export function letterSet(word: string): string[] {
  return [...new Set([...word].filter(isLetter))]
}

export function wrongLetters(s: State): string[] {
  return s.word === null ? [] : s.guessed.filter((l) => !s.word!.includes(l))
}

export const mistakes = (s: State) => wrongLetters(s).length

export const isSolved = (s: State) => s.word !== null && letterSet(s.word).every((l) => s.guessed.includes(l))

export function isLost(s: State, limit: Limit): boolean {
  return mistakes(s) >= limit
}

export interface Tile {
  ch: string
  /** Letters are hidden until guessed; punctuation and spaces are always shown. */
  shown: boolean
  letter: boolean
}

/** What to render. When `reveal` is true (round over) every letter is shown. */
export function tiles(s: State, reveal = false): Tile[] {
  return [...(s.word ?? '')].map((ch) => ({ ch, letter: isLetter(ch), shown: !isLetter(ch) || reveal || s.guessed.includes(ch) }))
}

// ---- Round flow -----------------------------------------------------------

function begin(round: number, guesser: Player, scores: [number, number], settings: Settings, deck: Deck | null, pool: readonly string[], random: Random): State {
  if (settings.mode === 'custom') {
    return { scores, round, guesser, phase: 'word', word: null, guessed: [], deck: null }
  }
  const d = draw(deck ?? newDeck(pool.length, random), pool.length, random, null)
  return { scores, round, guesser, phase: 'play', word: d.index === null ? null : pool[d.index], guessed: [], deck: d.deck }
}

/** `pool` is the list of normalised words for random mode (ignored for custom). */
export function newMatch(settings: Settings, pool: readonly string[], random: Random): State {
  return begin(1, 0, [0, 0], settings, null, pool, random)
}

/** Custom mode: the setter's word is accepted and play begins. */
export function setWord(state: State, input: string): Result<State> {
  if (state.phase !== 'word') return { ok: false, reason: 'not-awaiting-word' }
  const check = normalizeWord(input)
  if (!check.ok) return { ok: false, reason: check.error }
  return { ok: true, state: { ...state, phase: 'play', word: check.word, guessed: [] } }
}

export function guess(state: State, settings: Settings, letter: string): Result<State> {
  if (state.phase !== 'play' || state.word === null) return { ok: false, reason: 'not-playing' }
  const l = letter.toLocaleUpperCase('en')
  if (!isLetter(l)) return { ok: false, reason: 'not-a-letter' }
  if (state.guessed.includes(l)) return { ok: false, reason: 'duplicate' }
  const next: State = { ...state, guessed: [...state.guessed, l] }
  if (isSolved(next)) {
    const scores: [number, number] = [state.scores[0], state.scores[1]]
    scores[state.guesser] += 1
    return { ok: true, state: { ...next, phase: 'result', scores } }
  }
  if (isLost(next, settings.limit)) {
    const scores: [number, number] = [state.scores[0], state.scores[1]]
    if (settings.mode === 'custom') scores[setterOf(state)] += 1
    return { ok: true, state: { ...next, phase: 'result', scores } }
  }
  return { ok: true, state: next }
}

export const didGuesserWin = (s: State) => s.phase === 'result' && isSolved(s)

export function nextRound(state: State, settings: Settings, pool: readonly string[], random: Random): Result<State> {
  if (state.phase !== 'result') return { ok: false, reason: 'round-in-progress' }
  return { ok: true, state: begin(state.round + 1, other(state.guesser), state.scores, settings, state.deck, pool, random) }
}

// ---- Setup validation -----------------------------------------------------

export interface NameCheck {
  ok: boolean
  names: [string, string]
  errors: [string | null, string | null]
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

export function validateNames(a: string, b: string): NameCheck {
  const names: [string, string] = [clean(a), clean(b)]
  const errors: [string | null, string | null] = [null, null]
  names.forEach((n, i) => {
    if (n.length === 0) errors[i] = 'Enter a name.'
    else if (n.length > MAX_NAME_LENGTH) errors[i] = `Use ${MAX_NAME_LENGTH} characters or fewer.`
    else if (CONTROL.test(n)) errors[i] = 'Remove special characters.'
  })
  if (!errors[0] && !errors[1] && names[0].toLowerCase() === names[1].toLowerCase()) errors[1] = 'Names must be different.'
  return { ok: errors[0] === null && errors[1] === null, names, errors }
}

// ---- Save validation ------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 100000

export function parseSettings(raw: unknown, knownCategories: readonly string[]): Settings | null {
  if (!isObj(raw) || !Array.isArray(raw.names) || raw.names.length !== 2) return null
  const [a, b] = raw.names
  if (typeof a !== 'string' || typeof b !== 'string') return null
  const check = validateNames(a, b)
  if (!check.ok || check.names[0] !== a || check.names[1] !== b) return null
  if (raw.mode !== 'random' && raw.mode !== 'custom') return null
  if (!(LIMIT_OPTIONS as readonly unknown[]).includes(raw.limit)) return null
  if (!Array.isArray(raw.categoryIds)) return null
  const ids = raw.categoryIds
  if (raw.mode === 'custom' && ids.length !== 0) return null
  if (raw.mode === 'random' && (ids.length === 0 || new Set(ids).size !== ids.length || !ids.every((c) => typeof c === 'string' && knownCategories.includes(c)))) return null
  return { names: check.names, mode: raw.mode, limit: raw.limit as Limit, categoryIds: ids as string[] }
}

/** `pool` is the normalised random-mode word list (empty for custom). */
export function parseState(raw: unknown, settings: Settings, pool: readonly string[]): State | null {
  if (!isObj(raw)) return null
  const { scores, round, guesser, phase, word, guessed, deck } = raw
  if (!Array.isArray(scores) || scores.length !== 2 || !isCount(scores[0]) || !isCount(scores[1])) return null
  if (!isCount(round) || round < 1) return null
  if (guesser !== 0 && guesser !== 1) return null
  if (phase !== 'word' && phase !== 'play' && phase !== 'result') return null
  if (word !== null && typeof word !== 'string') return null
  if (!Array.isArray(guessed) || !guessed.every((l) => typeof l === 'string' && isLetter(l)) || new Set(guessed).size !== guessed.length) return null

  const finishedRounds = round - 1 + (phase === 'result' ? 1 : 0)
  const total = scores[0] + scores[1]
  if (settings.mode === 'custom' ? total !== finishedRounds : total > finishedRounds) return null

  const out: State = { scores: [scores[0], scores[1]], round, guesser, phase, word: word as string | null, guessed: guessed as string[], deck: null }

  if (settings.mode === 'custom') {
    if (deck !== null) return null
    if (guesser !== (round % 2 === 1 ? 0 : 1)) return null
    if (phase === 'word') {
      if (word !== null || guessed.length !== 0) return null
      return out
    }
  } else {
    const parsedDeck = parseDeck(deck, pool.length)
    if (!parsedDeck || pool.length < MIN_POOL) return null
    out.deck = parsedDeck
    if (guesser !== (round % 2 === 1 ? 0 : 1)) return null
    if (phase === 'word') return null
  }

  if (typeof word !== 'string') return null
  const check = normalizeWord(word)
  if (!check.ok || check.word !== word) return null
  if (settings.mode === 'random' && !pool.includes(word)) return null

  const solved = isSolved(out)
  const lost = isLost(out, settings.limit)
  if (phase === 'play' && (solved || lost)) return null
  if (phase === 'result') {
    if (solved === lost) return null // exactly one of won / lost
    // A finished round has no guesses beyond the one that ended it.
    if (out.guessed.length === 0) return null
    const before: State = { ...out, guessed: out.guessed.slice(0, -1) }
    if (isSolved(before) || isLost(before, settings.limit)) return null
  }
  return out
}
