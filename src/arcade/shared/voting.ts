// Pure secret-ballot machinery shared by Undercover and Mafia/Werewolf. Players vote one at a
// time on one device; nobody may vote for themselves. The most-voted candidate is eliminated.
// A tie goes to ONE runoff among the tied candidates (everyone else still votes, tied candidates
// vote for another tied candidate); a second tie eliminates nobody.
// No React, DOM, storage or network imports.

export interface Ballot {
  /** 1 = first ballot, 2 = runoff. */
  round: 1 | 2
  /** Voters in casting order. */
  voters: number[]
  /** Who may receive votes this ballot. */
  candidates: number[]
  /** votes[i] is the target voter i chose, or null if not cast yet. */
  votes: (number | null)[]
  /** Index into `voters` of the next voter. */
  cursor: number
}

export type Outcome = { kind: 'elected'; player: number } | { kind: 'tie'; tied: number[] }

export function newBallot(voters: readonly number[], candidates: readonly number[], round: 1 | 2): Ballot {
  return { round, voters: [...voters], candidates: [...candidates], votes: voters.map(() => null), cursor: 0 }
}

export const isComplete = (b: Ballot) => b.cursor >= b.voters.length
export const currentVoter = (b: Ballot): number | null => (isComplete(b) ? null : b.voters[b.cursor])

/** Targets the current voter may choose (candidates minus themselves). */
export function allowedTargets(b: Ballot): number[] {
  const v = currentVoter(b)
  return v === null ? [] : b.candidates.filter((c) => c !== v)
}

export type CastResult = { ok: true; ballot: Ballot } | { ok: false; reason: string }

export function castVote(b: Ballot, target: number): CastResult {
  if (isComplete(b)) return { ok: false, reason: 'ballot-complete' }
  if (!allowedTargets(b).includes(target)) return { ok: false, reason: b.voters[b.cursor] === target ? 'self-vote' : 'not-a-candidate' }
  const votes = b.votes.slice()
  votes[b.cursor] = target
  return { ok: true, ballot: { ...b, votes, cursor: b.cursor + 1 } }
}

export function counts(b: Ballot): Map<number, number> {
  const m = new Map<number, number>(b.candidates.map((c) => [c, 0]))
  for (const v of b.votes) if (v !== null) m.set(v, (m.get(v) ?? 0) + 1)
  return m
}

export function outcome(b: Ballot): Outcome {
  const m = counts(b)
  const top = Math.max(...m.values())
  const leaders = [...m.entries()].filter(([, n]) => n === top).map(([p]) => p)
  return leaders.length === 1 ? { kind: 'elected', player: leaders[0] } : { kind: 'tie', tied: leaders.sort((a, b2) => a - b2) }
}

/** The runoff ballot after a first-round tie (same voters, only the tied candidates). */
export function runoffBallot(first: Ballot, tied: readonly number[]): Ballot {
  return newBallot(first.voters, tied, 2)
}

// ---- Save validation ------------------------------------------------------

const isIndex = (v: unknown, n: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n

/** `playerCount` bounds player indexes; `alive` are the voters expected for the ballot (in order). */
export function parseBallot(raw: unknown, playerCount: number): Ballot | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { round, voters, candidates, votes, cursor } = raw as Record<string, unknown>
  if (round !== 1 && round !== 2) return null
  if (!Array.isArray(voters) || !Array.isArray(candidates) || !Array.isArray(votes)) return null
  if (voters.length < 2 || !voters.every((v) => isIndex(v, playerCount)) || new Set(voters).size !== voters.length) return null
  if (candidates.length < 2 || !candidates.every((c) => isIndex(c, playerCount)) || new Set(candidates).size !== candidates.length) return null
  if (votes.length !== voters.length) return null
  if (typeof cursor !== 'number' || !Number.isInteger(cursor) || cursor < 0 || cursor > voters.length) return null
  for (let i = 0; i < votes.length; i++) {
    const v = votes[i]
    if (i < cursor) {
      if (!isIndex(v, playerCount) || !candidates.includes(v) || v === voters[i]) return null
    } else if (v !== null) return null
  }
  return { round, voters: voters as number[], candidates: candidates as number[], votes: votes as (number | null)[], cursor }
}
