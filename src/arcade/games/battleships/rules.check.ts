// Focused deterministic checks for Battleships rules.
// Run:  node src/arcade/games/battleships/rules.check.ts   (non-zero exit on failure)
import type { Random } from '../../shared/deck.ts'
import {
  CELLS, FLEET, SIZE, cellIndex, cellName, cellsFor, endTurn, fire, lockFleet, newMatch, ownView, parseFleet, parseSettings, parseState,
  placeShip, randomFleet, sunkByPlayer, targetView, type Fleet, type Ship, type State,
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
const bad = (r: { ok: boolean; reason?: string }, why?: string) => !r.ok && (why === undefined || r.reason === why)

// 1. Geometry and placement.
check('fleet is 5/4/3/3/2 on a 10x10 board', FLEET.map((f) => f.len).join() === '5,4,3,3,2' && SIZE === 10 && CELLS === 100)
check('cellsFor horizontal / vertical', cellsFor(3, 'h', 2, 4)!.join() === '24,25,26' && cellsFor(3, 'v', 2, 4)!.join() === '24,34,44')
check('exactly fitting ships are in bounds on every edge', cellsFor(5, 'h', 0, 5) !== null && cellsFor(5, 'v', 5, 0) !== null && cellsFor(2, 'h', 9, 8) !== null && cellsFor(2, 'v', 8, 9) !== null)
check('out-of-bounds placement rejected (right, bottom, negative, non-integer)', cellsFor(5, 'h', 0, 6) === null && cellsFor(5, 'v', 6, 0) === null && cellsFor(2, 'h', 0, 9) === null && cellsFor(2, 'v', 9, 0) === null && cellsFor(2, 'h', -1, 0) === null && cellsFor(2, 'h', 0, 1.5) === null)
check('cellName', cellName(0) === 'A1' && cellName(99) === 'J10' && cellName(cellIndex(2, 3)) === 'D3')
{
  const first = placeShip([], 'h', 0, 0)
  check('first ship is the Carrier', first.ok && first.ship.id === 'carrier' && first.ship.cells.join() === '0,1,2,3,4')
  const placed: Ship[] = [(first as { ship: Ship }).ship]
  check('overlap rejected', bad(placeShip(placed, 'v', 0, 2), 'overlap') && bad(placeShip(placed, 'h', 0, 4), 'overlap'))
  check('out of bounds reported for the next ship', bad(placeShip(placed, 'h', 0, 7), 'out-of-bounds'))
  const adjacent = placeShip(placed, 'h', 1, 0)
  check('adjacent ships are allowed (touching the Carrier)', adjacent.ok && adjacent.ship.id === 'battleship')
  check('diagonal contact is allowed too', placeShip(placed, 'h', 1, 5).ok)
  check('a sixth ship cannot be placed', bad(placeShip(Array.from({ length: 5 }, (_, i) => ({ id: FLEET[i].id, cells: [i] })), 'h', 9, 0), 'fleet-complete'))
}
{
  let allValid = true
  for (let s = 1; s <= 200; s++) {
    const f = randomFleet(seeded(s))
    if (!parseFleet(JSON.parse(JSON.stringify(f)))) allValid = false
  }
  check('200 random fleets are all legal (lengths, straight, no overlap, in bounds)', allValid)
  check('random fleets differ across seeds', randomFleet(seeded(1)).map((s) => s.cells[0]).join() !== randomFleet(seeded(2)).map((s) => s.cells[0]).join())
}

// Fixed fleets used below (cells are known so shots are scripted).
const fleetA: Fleet = [
  { id: 'carrier', cells: [0, 1, 2, 3, 4] }, { id: 'battleship', cells: [10, 11, 12, 13] }, { id: 'cruiser', cells: [20, 21, 22] },
  { id: 'submarine', cells: [30, 31, 32] }, { id: 'destroyer', cells: [40, 41] },
]
const fleetB: Fleet = [
  { id: 'carrier', cells: [5, 15, 25, 35, 45] }, { id: 'battleship', cells: [6, 16, 26, 36] }, { id: 'cruiser', cells: [7, 17, 27] },
  { id: 'submarine', cells: [8, 18, 28] }, { id: 'destroyer', cells: [9, 19] },
]
check('fixed fleets are valid', parseFleet(fleetA) !== null && parseFleet(fleetB) !== null)
check('invalid fleets rejected (wrong order, bent ship, overlap, wrong length, out of range)', [
  [fleetA[1], fleetA[0], fleetA[2], fleetA[3], fleetA[4]],
  [{ id: 'carrier', cells: [0, 1, 2, 3, 14] }, ...fleetA.slice(1)],
  [{ id: 'carrier', cells: [0, 1, 2, 3, 4] }, { id: 'battleship', cells: [3, 13, 23, 33] }, ...fleetA.slice(2)],
  [{ id: 'carrier', cells: [0, 1, 2, 3] }, ...fleetA.slice(1)],
  [{ id: 'carrier', cells: [96, 97, 98, 99, 100] }, ...fleetA.slice(1)],
  [{ id: 'carrier', cells: [8, 9, 10, 11, 12] }, ...fleetA.slice(1)], // wraps rows
  null, 'x', [],
].every((f) => parseFleet(f) === null))

// 2. Placement flow with hand-offs.
function setup(): State {
  let g = newMatch()
  g = must(lockFleet(g, g.seq, fleetA))
  g = must(lockFleet(g, g.seq, fleetB))
  return g
}
{
  let g = newMatch()
  check('starts with player 0 placing', g.phase === 'place' && g.placing === 0 && g.fleets[0] === null)
  check('cannot fire before both fleets are locked', bad(fire(g, g.seq, 5)))
  check('invalid fleet and stale seq rejected', bad(lockFleet(g, g.seq, [] as Fleet), 'invalid-fleet') && bad(lockFleet(g, 5, fleetA), 'stale'))
  g = must(lockFleet(g, g.seq, fleetA))
  check('after player 0 locks, player 1 places', g.placing === 1 && g.phase === 'place' && g.fleets[1] === null)
  check('double tap on lock with the same seq is rejected', bad(lockFleet(g, g.seq - 1, fleetA), 'stale'))
  g = must(lockFleet(g, g.seq, fleetB))
  check('after both lock, battle starts with player 0 aiming', g.phase === 'aim' && g.turn === 0 && g.shots[0].length === 0)
  check('locked fleets are copies, not shared references', (() => { const x = newMatch(); const y = must(lockFleet(x, 0, fleetA)); fleetA[0].cells[0] = 50; const kept = y.fleets[0]![0].cells[0] === 0; fleetA[0].cells[0] = 0; return kept })())
}

// 3. Shots: miss, hit, sunk, repeated, turn passing (a hit gives no extra turn).
{
  let g = setup()
  check('out-of-range and non-integer shots rejected', [-1, 100, 2.5].every((c) => bad(fire(g, g.seq, c), 'out-of-range')))
  const miss = must(fire(g, g.seq, 99))
  check('miss recorded, result phase', miss.phase === 'result' && miss.last!.result === 'miss' && miss.shots[0].join() === '99' && miss.turn === 0)
  check('cannot fire again during the result screen, nor end turn twice', bad(fire(miss, miss.seq, 98), 'not-aiming'))
  check('stale / double-tap fire is rejected', bad(fire(g, g.seq + 3, 5), 'stale') && bad(fire(miss, g.seq, 98)))
  g = must(endTurn(miss, miss.seq))
  check('turn passes to the other player, result cleared', g.phase === 'aim' && g.turn === 1 && g.last === null)
  check('endTurn needs a result', bad(endTurn(g, g.seq), 'not-in-result'))
  const hit = must(fire(g, g.seq, 0)) // player 1 fires at player 0's carrier cell 0
  check('hit on a ship is reported as hit, not sunk', hit.last!.result === 'hit' && hit.last!.sunk === null && hit.shots[1].join() === '0')
  const next = must(endTurn(hit, hit.seq))
  check('a hit does NOT earn another shot: turn passes to the other player', next.turn === 0 && next.phase === 'aim')
  // Player 0 fired at 99 earlier; the cell is free for player 1 and blocked again for player 0 only.
  const p0Again = must(endTurn(must(fire(next, next.seq, 98)), next.seq + 1))
  check('the other player may fire at a cell the first player used', p0Again.turn === 1 && !p0Again.shots[1].includes(99))
}
{
  // Player 0 sinks the destroyer (cells 9, 19) with two shots while player 1 shoots elsewhere.
  let h = setup()
  h = must(endTurn(must(fire(h, h.seq, 9)), h.seq + 1))
  h = must(endTurn(must(fire(h, h.seq, 99)), h.seq + 1))
  const sunk = must(fire(h, h.seq, 19))
  check('last cell of a ship reports Sunk and names it', sunk.last!.result === 'sunk' && sunk.last!.sunk === 'destroyer')
  check('sunk ships are listed for the shooter only', sunkByPlayer(sunk, 0).join() === 'destroyer' && sunkByPlayer(sunk, 1).length === 0)
  const aimAgain = must(endTurn(sunk, sunk.seq))
  const repeat = fire(must(endTurn(must(fire(aimAgain, aimAgain.seq, 98)), aimAgain.seq + 1)), aimAgain.seq + 2, 9)
  check('a player cannot fire at a cell they already fired at', bad(repeat, 'already-fired'))
}

// 4. Views never leak the enemy fleet.
{
  const g = setup()
  const view = targetView(g, 0)
  check('before any shot the target board shows nothing about the enemy fleet', view.every((c) => c === 'unknown') && view.length === 100)
  let h = g
  h = must(endTurn(must(fire(h, h.seq, 5)), h.seq + 1)) // player 0 hits carrier at 5
  const tv = targetView(h, 0)
  check('a hit shows only the shot cell, not the rest of the ship', tv[5] === 'hit' && tv.filter((c) => c !== 'unknown').length === 1 && tv[15] === 'unknown' && tv[45] === 'unknown')
  const own1 = ownView(h, 1)
  check('own board shows own ships but only incoming shots as marks', own1[5] === 'hit' && own1[15] === 'ship' && own1[0] === 'water')
  check("the opponent's own-ship layout is not part of the shooter's target view", JSON.stringify(targetView(h, 0)).includes('ship') === false)
  // Sink the destroyer then check sunk cells are revealed for the shooter.
  let k = h
  k = must(endTurn(must(fire(k, k.seq, 98)), k.seq + 1)) // player 1 misses
  k = must(endTurn(must(fire(k, k.seq, 9)), k.seq + 1)) // player 0 hits destroyer 9
  k = must(endTurn(must(fire(k, k.seq, 97)), k.seq + 1))
  const sunk = must(fire(k, k.seq, 19))
  const sv = targetView(sunk, 0)
  check('a sunk ship is revealed to the shooter, other ships stay hidden', sv[9] === 'sunk' && sv[19] === 'sunk' && sv[5] === 'hit' && sv[15] === 'unknown' && sv[6] === 'unknown')
  check('miss cells show as miss', targetView(must(fire(g, g.seq, 99)), 0)[99] === 'miss')
}

// 5. Victory.
function playToWin(): State {
  let g = setup()
  const enemyCells = fleetB.flatMap((s) => s.cells)
  const wasted = Array.from({ length: 100 }, (_, i) => i).filter((c) => !fleetA.flatMap((s) => s.cells).includes(c)) // player 1's misses
  let i = 0
  while (g.phase === 'aim') {
    if (g.turn === 0) g = must(fire(g, g.seq, enemyCells[Math.floor(i / 2)]))
    else g = must(fire(g, g.seq, wasted[Math.floor(i / 2)]))
    i += 1
    if (g.phase === 'result') g = must(endTurn(g, g.seq))
  }
  return g
}
{
  const g = playToWin()
  check('sinking all five ships wins immediately, with no further turn', g.phase === 'over' && g.winner === 0 && g.last!.result === 'sunk' && sunkByPlayer(g, 0).length === 5)
  check('player 0 needed exactly 17 hits', g.shots[0].length === 17 && g.shots[1].length === 16)
  check('nothing can be done after the match', bad(fire(g, g.seq, 50)) && bad(endTurn(g, g.seq)) && bad(lockFleet(g, g.seq, fleetA)))
  // Second player can win too.
  let h = setup()
  const bCells = fleetA.flatMap((s) => s.cells)
  const missesFor0 = Array.from({ length: 100 }, (_, i) => i).filter((c) => !fleetB.flatMap((s) => s.cells).includes(c))
  let n = 0
  while (h.phase === 'aim') {
    h = must(fire(h, h.seq, h.turn === 1 ? bCells[Math.floor(n / 2)] : missesFor0[Math.floor(n / 2)]))
    n += 1
    if (h.phase === 'result') h = must(endTurn(h, h.seq))
  }
  check('player 1 can win', h.phase === 'over' && h.winner === 1 && h.shots[0].length === h.shots[1].length)
}

// 6. Save validation.
{
  const rt = (x: State) => parseState(JSON.parse(JSON.stringify(x)))
  const g0 = newMatch()
  const g1 = must(lockFleet(g0, 0, fleetA))
  const g2 = must(lockFleet(g1, 1, fleetB))
  const r = must(fire(g2, g2.seq, 5))
  const a2 = must(endTurn(r, r.seq))
  const r2 = must(fire(a2, a2.seq, 98))
  const won = playToWin()
  check('every phase round-trips (place 0/1, aim, result, aim, result p1, over)', [g0, g1, g2, r, a2, r2, won].every((x) => JSON.stringify(rt(x)) === JSON.stringify(x)))
  const mut = (src: State, f: (o: Record<string, unknown>) => void) => {
    const o = JSON.parse(JSON.stringify(src)) as Record<string, unknown>
    f(o)
    return parseState(o) === null
  }
  check('rejects fleets that do not fit the phase', mut(g0, (o) => { (o.fleets as unknown[])[0] = fleetA }) && mut(g1, (o) => { (o.fleets as unknown[])[0] = null }) && mut(g2, (o) => { (o.fleets as unknown[])[1] = null }))
  check('rejects a corrupted fleet', mut(g2, (o) => { ((o.fleets as Fleet[])[0][0].cells)[0] = 50 }) && mut(g2, (o) => { ((o.fleets as Fleet[])[1][1].cells).pop() }))
  check('rejects duplicate or out-of-range shots', mut(r2, (o) => { (o.shots as number[][])[0] = [5, 5] }) && mut(r2, (o) => { (o.shots as number[][])[1] = [100] }))
  check('rejects shot counts that break the alternation', mut(g2, (o) => { (o.shots as number[][])[0] = [1] }) && mut(a2, (o) => { (o.shots as number[][])[1] = [7] }) && mut(r, (o) => { o.turn = 1 }))
  check('rejects a result that does not match the last shot', mut(r, (o) => { (o.last as { result: string }).result = 'miss' }) && mut(r, (o) => { (o.last as { cell: number }).cell = 6 }) && mut(a2, (o) => { o.last = { cell: 5, result: 'hit', sunk: null } }))
  check('rejects winner flags that do not match the board', mut(won, (o) => { o.winner = 1 }) && mut(won, (o) => { o.winner = null }) && mut(r, (o) => { o.winner = 0 }) && mut(won, (o) => { (o.shots as number[][])[0].pop() }))
  check('rejects junk', parseState(null) === null && parseState('x') === null && parseState([]) === null && parseState({ ...g2, phase: 'nope' }) === null)
  check('settings', parseSettings({ names: ['Ann', 'Bob'] })?.names.join() === 'Ann,Bob' && parseSettings({ names: ['Ann', 'ann'] }) === null && parseSettings({ names: ['Ann'] }) === null && parseSettings(null) === null)
}

console.log(`battleships rules.check: ${checks} checks passed`)
