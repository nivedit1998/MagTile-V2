// Remembers which parts of MagTile you used today, so the Virtual Pet can react to real behaviour with
// nothing to type or tick. Stored only on this device: a few UK dates, never any content.
import { readPref, writePref } from '../arcade/storage/saves'
import { ukDay, type Activity } from './pet/rules'

const KEY = 'magtile.activity'
const MAX_VISITS = 60
const DAY = /^\d{4}-\d{2}-\d{2}$/

export function readActivity(): Activity {
  const v = readPref<Partial<Activity>>(KEY)
  const day = (x: unknown) => (typeof x === 'string' && DAY.test(x) ? x : null)
  const visits = Array.isArray(v?.visits) ? v.visits.filter((d): d is string => typeof d === 'string' && DAY.test(d)).slice(-MAX_VISITS) : []
  return { arcadeDay: day(v?.arcadeDay), discoverDay: day(v?.discoverDay), visits }
}

/** Call when the user opens a section. Cheap: writes only when something changed. */
export function recordActivity(kind: 'arcade' | 'discover' | 'mylife', now = Date.now()): void {
  const today = ukDay(now)
  const a = readActivity()
  const next: Activity = { ...a, visits: a.visits.includes(today) ? a.visits : [...a.visits, today].slice(-MAX_VISITS) }
  if (kind === 'arcade') next.arcadeDay = today
  if (kind === 'discover') next.discoverDay = today
  if (next.visits.length !== a.visits.length || next.arcadeDay !== a.arcadeDay || next.discoverDay !== a.discoverDay) writePref(KEY, next)
}
