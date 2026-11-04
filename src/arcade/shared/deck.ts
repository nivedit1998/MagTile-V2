// Pure no-repeat draw pile. A deck is a shuffled order over pool indices plus a cursor.
// Nothing repeats until every card has been drawn; then the pile is reshuffled and the
// card just drawn is never first again. No React, DOM, storage or network imports.

export type Random = () => number // [0, 1)

export interface Deck {
  /** A permutation of 0..size-1. */
  order: number[]
  /** How many cards of `order` have been drawn so far. */
  cursor: number
  /** How many times the pile ran out and was reshuffled. */
  reshuffles: number
}

export function shuffled(size: number, random: Random): number[] {
  const order = Array.from({ length: size }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

export function newDeck(size: number, random: Random): Deck {
  return { order: shuffled(size, random), cursor: 0, reshuffles: 0 }
}

export interface Draw {
  deck: Deck
  /** Pool index of the drawn card, or null when the pool is empty. */
  index: number | null
  /** True when this draw had to reshuffle an exhausted pile. */
  reshuffled: boolean
}

/** Draws the next card. `last` is the previously drawn index (kept off the top after a reshuffle). */
export function draw(deck: Deck, size: number, random: Random, last: number | null = null): Draw {
  if (size <= 0) return { deck, index: null, reshuffled: false }
  if (deck.cursor < size) {
    return { deck: { ...deck, cursor: deck.cursor + 1 }, index: deck.order[deck.cursor], reshuffled: false }
  }
  const order = shuffled(size, random)
  if (size > 1 && last !== null && order[0] === last) [order[0], order[1]] = [order[1], order[0]]
  return { deck: { order, cursor: 1, reshuffles: deck.reshuffles + 1 }, index: order[0], reshuffled: true }
}

export const cardsLeft = (deck: Deck, size: number) => Math.max(0, size - deck.cursor)

/** Strict validation of a stored deck against the current pool size. */
export function parseDeck(raw: unknown, size: number): Deck | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { order, cursor, reshuffles } = raw as Record<string, unknown>
  if (!Array.isArray(order) || order.length !== size) return null
  const seen = new Set<number>()
  for (const v of order) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= size || seen.has(v)) return null
    seen.add(v)
  }
  if (typeof cursor !== 'number' || !Number.isInteger(cursor) || cursor < 0 || cursor > size) return null
  if (typeof reshuffles !== 'number' || !Number.isInteger(reshuffles) || reshuffles < 0 || reshuffles > 1000) return null
  return { order: order as number[], cursor, reshuffles }
}
