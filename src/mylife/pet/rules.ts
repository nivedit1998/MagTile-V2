// Virtual Pet rules. Pure and deterministic: no React, no storage, no network, no timers.
// Time is always passed in, so the same save and the same clock give the same pet.
//
// The pet is driven by two things: how long it has been since you looked (computed from timestamps when
// the screen opens, never by a background timer) and what you actually do in MagTile (visiting the
// Arcade, reading Discover, learning the Word of the Day). It never dies: neglect makes it hungry, sad
// and tired, and care puts it right.

export const PET_SCHEMA = 1
export type Stage = 'egg' | 'baby' | 'child' | 'adult'
export type Form = 'plain' | 'scholar' | 'sprite'
export type Mood = 'sleeping' | 'tired' | 'hungry' | 'sad' | 'happy' | 'ok'

export const HATCH_MS = 60 * 60 * 1000
export const CHILD_AT_DAY = 3
export const ADULT_AT_DAY = 10
export const MAX_CATCH_UP_H = 48 // longest gap that is simulated (the needs have all floored at zero well before this)
export const STEP_MIN = 15
const SLEEP_FROM = 22 // UK hour the pet goes to sleep
const SLEEP_TO = 7 // UK hour it wakes
const FULL = 90 // a stat at or above this refuses more of the same care

export const NAMES = ['Pip', 'Mochi', 'Bean', 'Nova', 'Ziggy', 'Tofu', 'Pixel', 'Biscuit', 'Juno', 'Waffle', 'Olive', 'Comet'] as const

export interface Pet {
  schema: 1
  stage: Stage
  form: Form
  name: string | null
  eggAt: number
  hatchedAt: number | null
  lastTick: number
  food: number
  joy: number
  energy: number
  smarts: number
  fed: number // lifetime counts, for the stats panel
  played: number
  rested: number
  words: number
  lastWords: string[] // newest first, at most 5
  lastWordDay: string | null
  arcadeApplied: string | null // UK day whose Arcade visit has already been rewarded
  discoverApplied: string | null
  carePlay: number // drives the adult form
  careScholar: number
}

/** What the rest of the app writes down (see activity.ts); the pet only reads it. */
export interface Activity {
  arcadeDay: string | null
  discoverDay: string | null
  visits: string[] // UK days MagTile was used, newest last, at most 60
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))

export function ukParts(ms: number): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
}
export const ukDay = (ms: number) => ukParts(ms).day
export const isNight = (ms: number) => {
  const h = ukParts(ms).hour
  return h >= SLEEP_FROM || h < SLEEP_TO
}
const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000)
export const daysBetween = (fromDay: string, toDay: string) => dayNumber(toDay) - dayNumber(fromDay)

export function newPet(now: number): Pet {
  return {
    schema: PET_SCHEMA, stage: 'egg', form: 'plain', name: null, eggAt: now, hatchedAt: null, lastTick: now,
    food: 80, joy: 80, energy: 100, smarts: 0, fed: 0, played: 0, rested: 0, words: 0, lastWords: [], lastWordDay: null,
    arcadeApplied: null, discoverApplied: null, carePlay: 0, careScholar: 0,
  }
}

export function ageDays(pet: Pet, now: number): number {
  return pet.hatchedAt === null ? 0 : Math.max(0, daysBetween(ukDay(pet.hatchedAt), ukDay(now)))
}

export function minutesToHatch(pet: Pet, now: number): number {
  return pet.stage === 'egg' ? Math.max(0, Math.ceil((pet.eggAt + HATCH_MS - now) / 60_000)) : 0
}

function growth(pet: Pet, now: number): Pet {
  let next = pet
  if (next.stage === 'egg' && now >= next.eggAt + HATCH_MS) {
    const at = next.eggAt + HATCH_MS
    // Stats start fresh at the moment of hatching; the time since then is simulated below.
    next = { ...next, stage: 'baby', hatchedAt: at, lastTick: at, food: 80, joy: 80, energy: 100 }
  }
  if (next.stage === 'baby' && ageDays(next, now) >= CHILD_AT_DAY) next = { ...next, stage: 'child' }
  if (next.stage === 'child' && ageDays(next, now) >= ADULT_AT_DAY) {
    const form: Form = next.careScholar > next.carePlay ? 'scholar' : next.carePlay > next.careScholar ? 'sprite' : 'plain'
    next = { ...next, stage: 'adult', form }
  }
  return next
}

/** Brings a pet up to `now`: hatching, growing and the needs drifting, in 15-minute steps over UK night and day. */
export function tick(pet: Pet, now: number): Pet {
  let p = growth(pet, now)
  if (p.stage === 'egg') return { ...p, lastTick: now }
  let from = Math.max(p.lastTick, p.hatchedAt ?? p.lastTick)
  if (now < from) return { ...p, lastTick: now } // the clock went backwards; do nothing rather than guess
  from = Math.max(from, now - MAX_CATCH_UP_H * 3_600_000)
  let { food, joy, energy, smarts } = p
  const stepMs = STEP_MIN * 60_000
  for (let t = from; t < now; t += stepMs) {
    const h = Math.min(stepMs, now - t) / 3_600_000
    if (isNight(t)) {
      food -= 1 * h; joy -= 0.5 * h; energy += 10 * h
    } else {
      food -= 4 * h; joy -= 3 * h; energy -= 2 * h; smarts -= 0.5 * h
    }
    food = clamp(food); joy = clamp(joy); energy = clamp(energy); smarts = clamp(smarts)
  }
  p = { ...p, food, joy, energy, smarts, lastTick: now }
  return growth(p, now)
}

export function mood(pet: Pet, now: number): Mood {
  if (pet.stage === 'egg') return 'ok'
  if (isNight(now)) return 'sleeping'
  if (pet.energy < 20) return 'tired'
  if (pet.food < 25) return 'hungry'
  if (pet.joy < 25) return 'sad'
  if (pet.food >= 60 && pet.joy >= 60 && pet.energy >= 40) return 'happy'
  return 'ok'
}

export type ActionResult = { ok: true; pet: Pet; message: string } | { ok: false; pet: Pet; message: string }

const refuse = (pet: Pet, message: string): ActionResult => ({ ok: false, pet, message })

export function feed(pet: Pet, now: number): ActionResult {
  const p = tick(pet, now)
  if (p.stage === 'egg') return refuse(p, 'Still an egg.')
  if (isNight(now)) return refuse(p, 'Asleep. Let it rest.')
  if (p.food >= FULL) return refuse(p, 'Not hungry.')
  return { ok: true, pet: { ...p, food: clamp(p.food + 30), fed: p.fed + 1 }, message: 'Yum!' }
}

export function play(pet: Pet, now: number): ActionResult {
  const p = tick(pet, now)
  if (p.stage === 'egg') return refuse(p, 'Still an egg.')
  if (isNight(now)) return refuse(p, 'Asleep. Let it rest.')
  if (p.energy < 20) return refuse(p, 'Too tired to play.')
  if (p.joy >= FULL) return refuse(p, 'Already thrilled.')
  return { ok: true, pet: { ...p, joy: clamp(p.joy + 25), energy: clamp(p.energy - 15), played: p.played + 1, carePlay: p.carePlay + 1 }, message: 'That was fun!' }
}

export function rest(pet: Pet, now: number): ActionResult {
  const p = tick(pet, now)
  if (p.stage === 'egg') return refuse(p, 'Still an egg.')
  if (isNight(now)) return refuse(p, 'Already asleep.')
  if (p.energy >= FULL) return refuse(p, 'Not sleepy.')
  return { ok: true, pet: { ...p, energy: clamp(p.energy + 35), rested: p.rested + 1 }, message: 'Zzz… much better.' }
}

export function chooseName(pet: Pet, name: string): Pet {
  if (pet.stage === 'egg' || pet.name !== null || !(NAMES as readonly string[]).includes(name)) return pet
  return { ...pet, name }
}

/** Learns today's Word of the Day (once per UK day). Only called for a word the app really showed you. */
export function learnWord(pet: Pet, word: string, day: string): Pet {
  if (pet.stage === 'egg' || pet.lastWordDay === day || word.trim() === '') return pet
  return { ...pet, words: pet.words + 1, lastWords: [word.trim().slice(0, 40), ...pet.lastWords].slice(0, 5), lastWordDay: day, smarts: clamp(pet.smarts + 10), careScholar: pet.careScholar + 1 }
}

/** Rewards real use of MagTile, once per UK day for each kind. */
export function applyActivity(pet: Pet, activity: Activity, today: string): Pet {
  if (pet.stage === 'egg') return pet
  let p = pet
  if (activity.arcadeDay === today && p.arcadeApplied !== today) p = { ...p, arcadeApplied: today, joy: clamp(p.joy + 20), carePlay: p.carePlay + 1 }
  if (activity.discoverDay === today && p.discoverApplied !== today) p = { ...p, discoverApplied: today, smarts: clamp(p.smarts + 15), careScholar: p.careScholar + 1 }
  return p
}

/** Consecutive UK days of use, counting today or, if you have not been in yet today, ending yesterday. */
export function streak(visits: readonly string[], today: string): number {
  const days = new Set(visits)
  let day = today
  if (!days.has(day)) day = shiftDay(today, -1)
  let n = 0
  while (days.has(day)) {
    n += 1
    day = shiftDay(day, -1)
  }
  return n
}
export const shiftDay = (day: string, by: number) => new Date((dayNumber(day) + by) * 86_400_000).toISOString().slice(0, 10)

/** One short line of what the pet is thinking, from real things that happened. */
export function thought(pet: Pet, activity: Activity, today: string, now: number): string {
  if (pet.stage === 'egg') return minutesToHatch(pet, now) > 0 ? `Something is stirring… ${minutesToHatch(pet, now)} min to go.` : 'It is about to hatch!'
  if (pet.name === null) return 'Hello! What is my name?'
  const m = mood(pet, now)
  if (m === 'sleeping') return 'Zzz… back at 07:00.'
  if (m === 'hungry') return 'My tummy is rumbling.'
  if (m === 'tired') return 'So sleepy… can I rest?'
  if (m === 'sad') return 'I miss playing with you.'
  if (pet.lastWordDay === today && pet.lastWords[0]) return `Today I learned “${pet.lastWords[0]}”!`
  if (activity.arcadeDay !== today) return 'Shall we visit the Arcade?'
  if (activity.discoverDay !== today) return 'What is today’s word? Check Discover!'
  return m === 'happy' ? 'Life is good.' : 'Hello again.'
}

/** True if the stored value is a pet this version can safely use. */
export function parsePet(v: unknown): Pet | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const num = (k: string, lo = 0, hi = 1e15) => typeof o[k] === 'number' && Number.isFinite(o[k] as number) && (o[k] as number) >= lo && (o[k] as number) <= hi
  const dayOrNull = (k: string) => o[k] === null || (typeof o[k] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o[k] as string))
  if (o.schema !== PET_SCHEMA) return null
  if (!['egg', 'baby', 'child', 'adult'].includes(o.stage as string) || !['plain', 'scholar', 'sprite'].includes(o.form as string)) return null
  if (!(o.name === null || (typeof o.name === 'string' && (NAMES as readonly string[]).includes(o.name)))) return null
  if (!num('eggAt') || !num('lastTick') || !(o.hatchedAt === null || num('hatchedAt'))) return null
  for (const k of ['food', 'joy', 'energy', 'smarts']) if (!num(k, 0, 100)) return null
  for (const k of ['fed', 'played', 'rested', 'words', 'carePlay', 'careScholar']) if (!num(k, 0, 1e7)) return null
  if (!dayOrNull('lastWordDay') || !dayOrNull('arcadeApplied') || !dayOrNull('discoverApplied')) return null
  if (!Array.isArray(o.lastWords) || o.lastWords.length > 5 || !o.lastWords.every((w) => typeof w === 'string' && w.length <= 40)) return null
  if ((o.stage !== 'egg') !== (o.hatchedAt !== null)) return null
  return o as unknown as Pet
}
