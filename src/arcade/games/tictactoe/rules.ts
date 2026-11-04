// Pure Tic-Tac-Toe rules. No React, DOM, storage or network imports.

export type Player = 0 | 1
export type Cell = Player | null
export type MatchLength = 1 | 3 | 5
export type RoundStatus = 'playing' | 'won' | 'draw'

export const GAME_VERSION = 1
export const MATCH_LENGTHS: readonly MatchLength[] = [1, 3, 5]
export const MARKS = ['X', 'O'] as const
export const MAX_NAME_LENGTH = 14

export const LINES: readonly (readonly number[])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

export interface Settings {
  names: [string, string]
  rounds: MatchLength
}

export interface State {
  board: Cell[]
  /** Who opened the match; later rounds alternate from here. */
  firstStarter: Player
  /** Who opened the current round. */
  starter: Player
  /** Player to move, or (once the round ends) the player who made the last move. */
  turn: Player
  roundIndex: number
  roundStatus: RoundStatus
  winner: Player | null
  line: number[] | null
  scores: [number, number]
  draws: number
  matchOver: boolean
}

export type Result<T> = { ok: true; state: T } | { ok: false; reason: string }

export const other = (p: Player): Player => (p === 0 ? 1 : 0)

export function evaluate(board: readonly Cell[]): { status: RoundStatus; winner: Player | null; line: number[] | null } {
  for (const line of LINES) {
    const [a, b, c] = line
    const v = board[a]
    if (v !== null && v === board[b] && v === board[c]) return { status: 'won', winner: v, line: [...line] }
  }
  return { status: board.every((c) => c !== null) ? 'draw' : 'playing', winner: null, line: null }
}

export function isMatchOver(scores: readonly [number, number], draws: number, rounds: MatchLength): boolean {
  const played = scores[0] + scores[1] + draws
  return Math.max(scores[0], scores[1]) > rounds / 2 || played >= rounds
}

export function newMatch(starter: Player): State {
  return {
    board: Array<Cell>(9).fill(null),
    firstStarter: starter,
    starter,
    turn: starter,
    roundIndex: 0,
    roundStatus: 'playing',
    winner: null,
    line: null,
    scores: [0, 0],
    draws: 0,
    matchOver: false,
  }
}

/** Starting player for a replayed match: alternates from the last round's starter. */
export const replayStarter = (state: State): Player => other(state.starter)

export function place(state: State, settings: Settings, player: Player, cell: number): Result<State> {
  if (state.matchOver) return { ok: false, reason: 'match-over' }
  if (state.roundStatus !== 'playing') return { ok: false, reason: 'round-over' }
  if (player !== state.turn) return { ok: false, reason: 'out-of-turn' }
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return { ok: false, reason: 'out-of-range' }
  if (state.board[cell] !== null) return { ok: false, reason: 'occupied' }

  const board = state.board.slice()
  board[cell] = player
  const ev = evaluate(board)
  const scores: [number, number] = [state.scores[0], state.scores[1]]
  let draws = state.draws
  if (ev.status === 'won') scores[player] += 1
  if (ev.status === 'draw') draws += 1
  return {
    ok: true,
    state: {
      ...state,
      board,
      turn: ev.status === 'playing' ? other(player) : player,
      roundStatus: ev.status,
      winner: ev.winner,
      line: ev.line,
      scores,
      draws,
      matchOver: ev.status !== 'playing' && isMatchOver(scores, draws, settings.rounds),
    },
  }
}

export function nextRound(state: State): Result<State> {
  if (state.matchOver) return { ok: false, reason: 'match-over' }
  if (state.roundStatus === 'playing') return { ok: false, reason: 'round-in-progress' }
  const starter = other(state.starter)
  return {
    ok: true,
    state: {
      ...state,
      board: Array<Cell>(9).fill(null),
      starter,
      turn: starter,
      roundIndex: state.roundIndex + 1,
      roundStatus: 'playing',
      winner: null,
      line: null,
    },
  }
}

/** Match winner once over; null means a tied match. */
export function matchWinner(state: State): Player | null {
  if (state.scores[0] === state.scores[1]) return null
  return state.scores[0] > state.scores[1] ? 0 : 1
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
  if (!errors[0] && !errors[1] && names[0].toLowerCase() === names[1].toLowerCase()) {
    errors[1] = 'Names must be different.'
  }
  return { ok: errors[0] === null && errors[1] === null, names, errors }
}

// ---- Save validation ------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isPlayer = (v: unknown): v is Player => v === 0 || v === 1
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1000

export function parseSettings(raw: unknown): Settings | null {
  if (!isObj(raw) || !Array.isArray(raw.names) || raw.names.length !== 2) return null
  const [a, b] = raw.names
  if (typeof a !== 'string' || typeof b !== 'string') return null
  const check = validateNames(a, b)
  if (!check.ok || check.names[0] !== a || check.names[1] !== b) return null
  const rounds = raw.rounds
  if (rounds !== 1 && rounds !== 3 && rounds !== 5) return null
  return { names: check.names, rounds }
}

/** Strictly validates a stored state against its settings. Returns null if anything is inconsistent. */
export function parseState(raw: unknown, settings: Settings): State | null {
  if (!isObj(raw)) return null
  const { board, firstStarter, starter, turn, roundIndex, roundStatus, winner, line, scores, draws, matchOver } = raw
  if (!Array.isArray(board) || board.length !== 9) return null
  if (!board.every((c) => c === null || c === 0 || c === 1)) return null
  if (!isPlayer(firstStarter) || !isPlayer(starter) || !isPlayer(turn)) return null
  if (!isCount(roundIndex) || !isCount(draws)) return null
  if (roundStatus !== 'playing' && roundStatus !== 'won' && roundStatus !== 'draw') return null
  if (winner !== null && !isPlayer(winner)) return null
  if (typeof matchOver !== 'boolean') return null
  if (!Array.isArray(scores) || scores.length !== 2 || !isCount(scores[0]) || !isCount(scores[1])) return null
  if (line !== null && !(Array.isArray(line) && line.every((n) => Number.isInteger(n)))) return null

  const cells = board as Cell[]
  const moves = cells.filter((c) => c !== null).length
  const starterMarks = cells.filter((c) => c === starter).length
  if (starterMarks !== Math.ceil(moves / 2)) return null

  const ev = evaluate(cells)
  if (ev.status !== roundStatus || ev.winner !== winner) return null
  if (JSON.stringify(ev.line) !== JSON.stringify(line)) return null

  const lastMover: Player = moves % 2 === 1 ? starter : other(starter)
  const sc: [number, number] = [scores[0], scores[1]]
  const finished = roundStatus !== 'playing'
  if (finished) {
    if (turn !== lastMover) return null
    if (roundStatus === 'won' && winner !== lastMover) return null
  } else if (turn !== (moves % 2 === 0 ? starter : other(starter))) {
    return null
  }

  const completed = sc[0] + sc[1] + draws
  if (roundIndex !== completed - (finished ? 1 : 0)) return null
  if (starter !== (roundIndex % 2 === 0 ? firstStarter : other(firstStarter))) return null
  if (matchOver !== (finished && isMatchOver(sc, draws, settings.rounds))) return null
  if (!finished && isMatchOver(sc, draws, settings.rounds)) return null

  return { board: cells, firstStarter, starter, turn, roundIndex, roundStatus, winner, line: line as number[] | null, scores: sc, draws, matchOver }
}
