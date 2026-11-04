// Pure Battleships rules. No React, DOM, storage or network imports.
//
// Variant (documented on the Rules screen): two players share one device. 10 x 10 grid, fleet of
// Carrier 5, Battleship 4, Cruiser 3, Submarine 3, Destroyer 2. Ships lie in straight lines, may
// touch (adjacency allowed) but never overlap or leave the grid. Players place their fleet in
// private, then alternate single shots; a hit does NOT earn another shot. A shot at a cell already
// fired at is rejected. The result is Miss, Hit, or Sunk (naming the ship). Sinking all five ships wins.
// Views handed to the UI only ever contain what the viewing player may know.

import { type Random } from '../../shared/deck.ts'
import { namesAreClean } from '../../shared/names.ts'

export const GAME_VERSION = 1
export const SIZE = 10
export const CELLS = SIZE * SIZE

export const FLEET = [
  { id: 'carrier', name: 'Carrier', len: 5 },
  { id: 'battleship', name: 'Battleship', len: 4 },
  { id: 'cruiser', name: 'Cruiser', len: 3 },
  { id: 'submarine', name: 'Submarine', len: 3 },
  { id: 'destroyer', name: 'Destroyer', len: 2 },
] as const

export type Orientation = 'h' | 'v'
export type Player = 0 | 1
export type Phase = 'place' | 'aim' | 'result' | 'over'
export type ShotResult = 'miss' | 'hit' | 'sunk'

export interface Ship {
  id: string
  /** Ascending cell indexes. */
  cells: number[]
}
export type Fleet = Ship[]

export interface Settings {
  names: [string, string]
}

export interface LastShot {
  cell: number
  result: ShotResult
  /** Ship id when the result is `sunk`. */
  sunk: string | null
}

export interface State {
  phase: Phase
  /** Player placing their fleet (place phase). */
  placing: Player
  fleets: [Fleet | null, Fleet | null]
  /** shots[p] = cells player p has fired at the opponent, in order. */
  shots: [number[], number[]]
  /** Who is aiming, or who just fired. */
  turn: Player
  last: LastShot | null
  winner: Player | null
  seq: number
}

export type Result<T> = { ok: true; state: T } | { ok: false; reason: string }
const reject = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })

export const other = (p: Player): Player => (p === 0 ? 1 : 0)
export const cellIndex = (row: number, col: number) => row * SIZE + col
export const rowOf = (cell: number) => Math.floor(cell / SIZE)
export const colOf = (cell: number) => cell % SIZE
export const COLUMN_LABELS = [...'ABCDEFGHIJ']
export const cellName = (cell: number) => `${COLUMN_LABELS[colOf(cell)]}${rowOf(cell) + 1}`

// ---- Placement ------------------------------------------------------------

/** Cells for a ship of `len` anchored at its top-left (row, col). Null if it leaves the grid. */
export function cellsFor(len: number, orientation: Orientation, row: number, col: number): number[] | null {
  if (![row, col].every((v) => Number.isInteger(v) && v >= 0 && v < SIZE)) return null
  const end = orientation === 'h' ? col + len : row + len
  if (end > SIZE) return null
  return Array.from({ length: len }, (_, k) => (orientation === 'h' ? cellIndex(row, col + k) : cellIndex(row + k, col)))
}

/** Places the next ship of the fleet. `placed` are the ships already on the board. */
export function placeShip(placed: readonly Ship[], orientation: Orientation, row: number, col: number): { ok: true; ship: Ship } | { ok: false; reason: string } {
  if (placed.length >= FLEET.length) return reject('fleet-complete')
  const def = FLEET[placed.length]
  const cells = cellsFor(def.len, orientation, row, col)
  if (!cells) return reject('out-of-bounds')
  const used = new Set(placed.flatMap((s) => s.cells))
  if (cells.some((c) => used.has(c))) return reject('overlap')
  return { ok: true, ship: { id: def.id, cells } }
}

/** A complete random legal fleet (adjacency allowed). */
export function randomFleet(random: Random): Fleet {
  const fleet: Ship[] = []
  for (const def of FLEET) {
    for (let tries = 0; ; tries++) {
      if (tries > 500) return randomFleet(random) // practically unreachable on an empty-ish 10x10 board
      const o: Orientation = random() < 0.5 ? 'h' : 'v'
      const r = placeShip(fleet, o, Math.min(SIZE - 1, Math.floor(random() * SIZE)), Math.min(SIZE - 1, Math.floor(random() * SIZE)))
      if (r.ok) {
        fleet.push(r.ship)
        break
      }
    }
  }
  return fleet
}

/** Strict validation of a complete fleet (also used for saves). */
export function parseFleet(raw: unknown): Fleet | null {
  if (!Array.isArray(raw) || raw.length !== FLEET.length) return null
  const used = new Set<number>()
  const out: Fleet = []
  for (let i = 0; i < FLEET.length; i++) {
    const s = raw[i] as { id?: unknown; cells?: unknown } | null
    if (typeof s !== 'object' || s === null || s.id !== FLEET[i].id || !Array.isArray(s.cells) || s.cells.length !== FLEET[i].len) return null
    const cells = s.cells as unknown[]
    if (!cells.every((c) => typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < CELLS)) return null
    const cs = cells as number[]
    for (let k = 1; k < cs.length; k++) if (cs[k] <= cs[k - 1]) return null
    const horizontal = cs.every((c, k) => c === cs[0] + k) && rowOf(cs[0]) === rowOf(cs[cs.length - 1])
    const vertical = cs.every((c, k) => c === cs[0] + k * SIZE)
    if (!horizontal && !vertical) return null
    for (const c of cs) {
      if (used.has(c)) return null
      used.add(c)
    }
    out.push({ id: FLEET[i].id, cells: cs })
  }
  return out
}

// ---- Match flow -----------------------------------------------------------

export function newMatch(): State {
  return { phase: 'place', placing: 0, fleets: [null, null], shots: [[], []], turn: 0, last: null, winner: null, seq: 0 }
}

const bump = (s: State, patch: Partial<State>): State => ({ ...s, ...patch, seq: s.seq + 1 })

/** The placing player locks a complete fleet. */
export function lockFleet(s: State, seq: number, fleet: Fleet): Result<State> {
  if (seq !== s.seq) return reject('stale')
  if (s.phase !== 'place') return reject('not-placing')
  if (!parseFleet(fleet)) return reject('invalid-fleet')
  const fleets: [Fleet | null, Fleet | null] = [s.fleets[0], s.fleets[1]]
  fleets[s.placing] = fleet.map((ship) => ({ id: ship.id, cells: [...ship.cells] }))
  if (s.placing === 0) return { ok: true, state: bump(s, { fleets, placing: 1 }) }
  return { ok: true, state: bump(s, { fleets, phase: 'aim', turn: 0 }) }
}

export function sunkIds(fleet: Fleet, fired: readonly number[]): string[] {
  const set = new Set(fired)
  return fleet.filter((ship) => ship.cells.every((c) => set.has(c))).map((ship) => ship.id)
}

export function fire(s: State, seq: number, cell: number): Result<State> {
  if (seq !== s.seq) return reject('stale')
  if (s.phase !== 'aim') return reject('not-aiming')
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return reject('out-of-range')
  const mine = s.shots[s.turn]
  if (mine.includes(cell)) return reject('already-fired')
  const enemy = s.fleets[other(s.turn)]!
  const shots: [number[], number[]] = [s.shots[0].slice(), s.shots[1].slice()]
  shots[s.turn] = [...mine, cell]
  const hitShip = enemy.find((ship) => ship.cells.includes(cell))
  const sunkNow = hitShip && sunkIds(enemy, shots[s.turn]).includes(hitShip.id) ? hitShip.id : null
  const result: ShotResult = !hitShip ? 'miss' : sunkNow ? 'sunk' : 'hit'
  const last: LastShot = { cell, result, sunk: sunkNow }
  const won = sunkIds(enemy, shots[s.turn]).length === FLEET.length
  return { ok: true, state: bump(s, { shots, last, phase: won ? 'over' : 'result', winner: won ? s.turn : null }) }
}

/** After a shot's result has been seen, pass the device to the other player (a hit earns no extra shot). */
export function endTurn(s: State, seq: number): Result<State> {
  if (seq !== s.seq) return reject('stale')
  if (s.phase !== 'result') return reject('not-in-result')
  return { ok: true, state: bump(s, { phase: 'aim', turn: other(s.turn), last: null }) }
}

// ---- Views (what a player is allowed to see) -------------------------------

export type TargetCell = 'unknown' | 'miss' | 'hit' | 'sunk'
export type OwnCell = 'water' | 'ship' | 'miss' | 'hit'

/** The firing player's knowledge of the enemy board: shots, hits, and the cells of ships they have sunk. Nothing else. */
export function targetView(s: State, player: Player): TargetCell[] {
  const enemy = s.fleets[other(player)]
  const fired = s.shots[player]
  const sunkCells = new Set(enemy ? enemy.filter((sh) => sunkIds([sh], fired).length === 1).flatMap((sh) => sh.cells) : [])
  const hitCells = new Set(enemy ? enemy.flatMap((sh) => sh.cells) : [])
  return Array.from({ length: CELLS }, (_, c) => {
    if (!fired.includes(c)) return 'unknown'
    if (sunkCells.has(c)) return 'sunk'
    return hitCells.has(c) ? 'hit' : 'miss'
  })
}

/** A player's own board with the enemy's shots applied. */
export function ownView(s: State, player: Player): OwnCell[] {
  const fleet = s.fleets[player]
  const shipCells = new Set(fleet ? fleet.flatMap((sh) => sh.cells) : [])
  const incoming = new Set(s.shots[other(player)])
  return Array.from({ length: CELLS }, (_, c) => (incoming.has(c) ? (shipCells.has(c) ? 'hit' : 'miss') : shipCells.has(c) ? 'ship' : 'water'))
}

/** Ships of the enemy that `player` has sunk. */
export const sunkByPlayer = (s: State, player: Player): string[] => {
  const enemy = s.fleets[other(player)]
  return enemy ? sunkIds(enemy, s.shots[player]) : []
}

// ---- Save validation ------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseSettings(raw: unknown): Settings | null {
  if (!isObj(raw) || !namesAreClean(raw.names, 2, 2)) return null
  return { names: [raw.names[0], raw.names[1]] }
}

function parseShots(v: unknown): number[] | null {
  if (!Array.isArray(v) || !v.every((c) => typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < CELLS)) return null
  return new Set(v).size === v.length ? (v as number[]) : null
}

export function parseState(raw: unknown): State | null {
  if (!isObj(raw)) return null
  const { phase, placing, fleets, shots, turn, last, winner, seq } = raw
  if (phase !== 'place' && phase !== 'aim' && phase !== 'result' && phase !== 'over') return null
  if ((placing !== 0 && placing !== 1) || (turn !== 0 && turn !== 1)) return null
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return null
  if (!Array.isArray(fleets) || fleets.length !== 2 || !Array.isArray(shots) || shots.length !== 2) return null
  const s0 = parseShots(shots[0])
  const s1 = parseShots(shots[1])
  if (!s0 || !s1) return null
  const f0 = fleets[0] === null ? null : parseFleet(fleets[0])
  const f1 = fleets[1] === null ? null : parseFleet(fleets[1])
  if ((fleets[0] !== null && !f0) || (fleets[1] !== null && !f1)) return null
  // The two fleets live on separate boards, so they may use the same cell numbers.

  if (phase === 'place') {
    if (s0.length || s1.length || last !== null || winner !== null) return null
    if (placing === 0 ? f0 !== null || f1 !== null : f0 === null || f1 !== null) return null
    return { phase, placing, fleets: [f0, f1], shots: [s0, s1], turn, last: null, winner: null, seq }
  }
  if (!f0 || !f1) return null

  // Shot counts follow the alternation: player 0 always shoots first.
  // aiming: turn 0 when level, turn 1 when player 0 is one ahead; after a shot the counts are the reverse.
  const diff = s0.length - s1.length
  const okCounts = phase === 'aim' ? (turn === 0 ? diff === 0 : diff === 1) : turn === 0 ? diff === 1 : diff === 0
  if (!okCounts) return null

  const sunk0 = sunkIds(f1, s0).length === FLEET.length
  const sunk1 = sunkIds(f0, s1).length === FLEET.length
  if (phase === 'aim' || phase === 'result') {
    if (sunk0 || sunk1 || winner !== null) return null
  }
  if (phase === 'over') {
    if (winner !== 0 && winner !== 1) return null
    if (winner !== turn) return null
    if (winner === 0 ? !sunk0 || sunk1 : !sunk1 || sunk0) return null
  }

  let ls: LastShot | null = null
  if (phase === 'aim') {
    if (last !== null) return null
  } else {
    if (!isObj(last)) return null
    const mine = turn === 0 ? s0 : s1
    const enemy = turn === 0 ? f1 : f0
    const cell = mine[mine.length - 1]
    if (last.cell !== cell) return null
    const hitShip = enemy.find((sh) => sh.cells.includes(cell))
    const sunkNow = hitShip && sunkIds(enemy, mine).includes(hitShip.id) ? hitShip.id : null
    const result: ShotResult = !hitShip ? 'miss' : sunkNow ? 'sunk' : 'hit'
    if (last.result !== result || last.sunk !== sunkNow) return null
    ls = { cell, result, sunk: sunkNow }
  }
  return { phase, placing, fleets: [f0, f1], shots: [s0, s1], turn, last: ls, winner: phase === 'over' ? (winner as Player) : null, seq }
}
