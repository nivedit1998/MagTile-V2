// Pure timestamp-based countdown. The clock is injected (`now` in ms), never counted by
// intervals. Policy: an explicit pause freezes the round; time while the page is hidden or
// the device sleeps still counts (the deadline is absolute) and is reconciled on resume.
// No React, DOM, storage or network imports.

export interface Timer {
  /** Absolute deadline in ms while running, otherwise null. */
  endsAt: number | null
  /** Milliseconds left when not running (set at start and on pause). */
  remainingMs: number
}

export const startTimer = (durationMs: number, now: number): Timer => ({ endsAt: now + durationMs, remainingMs: durationMs })

export const idleTimer = (durationMs: number): Timer => ({ endsAt: null, remainingMs: durationMs })

export const isRunning = (t: Timer) => t.endsAt !== null

/** Milliseconds left at `now` (never negative). */
export function remaining(t: Timer, now: number): number {
  return t.endsAt === null ? t.remainingMs : Math.max(0, t.endsAt - now)
}

export const isExpired = (t: Timer, now: number) => t.endsAt !== null && now >= t.endsAt

export function pause(t: Timer, now: number): Timer {
  return t.endsAt === null ? t : { endsAt: null, remainingMs: remaining(t, now) }
}

export function resume(t: Timer, now: number): Timer {
  return t.endsAt !== null || t.remainingMs <= 0 ? t : { endsAt: now + t.remainingMs, remainingMs: t.remainingMs }
}

/** Whole seconds to display, rounded up so "0" only shows at the deadline. */
export const displaySeconds = (ms: number) => Math.ceil(ms / 1000)

export function parseTimer(raw: unknown, maxMs: number): Timer | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { endsAt, remainingMs } = raw as Record<string, unknown>
  if (typeof remainingMs !== 'number' || !Number.isFinite(remainingMs) || remainingMs < 0 || remainingMs > maxMs) return null
  if (endsAt !== null && (typeof endsAt !== 'number' || !Number.isFinite(endsAt) || endsAt <= 0)) return null
  return { endsAt: endsAt as number | null, remainingMs }
}
