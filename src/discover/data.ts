// Discover content: one small public JSON file, refreshed on the server by tools/discover/ingest.mjs.
// The device only ever downloads it (anonymous GET), keeps the last good copy in localStorage, and
// always shows when that copy was produced. Nothing is sent from the device.

import { useCallback, useEffect, useRef, useState } from 'react'
import { readPref, writePref } from '../arcade/storage/saves'

export const SCHEMA = 1
const BUNDLE_KEY = 'magtile.discover.bundle'
const ATTEMPT_KEY = 'magtile.discover.attempt'
const STATE_KEY = 'magtile.discover.state'
const MAX_BYTES = 400_000
const TIMEOUT_MS = 10_000
export const AUTO_INTERVAL_MS = 60 * 60 * 1000 // news is checked hourly while connected
export const MANUAL_INTERVAL_MS = 60 * 1000

export interface NewsItem { h: string; s: string; t: string | null }
export interface NewsSection { id: string; name: string; items: NewsItem[] }
export interface News { fetchedAt: string; source: string; sections: NewsSection[] }
export interface FactItem { title: string; fact: string; about: string; category: string | null }
export interface Facts { day: string; fetchedAt: string; source: string; items: FactItem[] }
export interface HistoryItem { year: number; text: string }
export interface History { day: string; date: string; fetchedAt: string; source: string; items: HistoryItem[] }
export interface Trivia { day: string; fetchedAt: string; source: string; category: string; difficulty: string; question: string; options: string[]; answer: number }
export interface Riddle { day: string; fetchedAt: string; source: string; title: string | null; question: string; answer: string }
export interface Word { day: string; fetchedAt: string; source: string; word: string; partOfSpeech: string | null; definition: string; example: string | null }

export interface Bundle {
  schema: number
  generatedAt: string
  day: string
  news: News | null
  facts: Facts | null
  history: History | null
  trivia: Trivia | null
  riddle: Riddle | null
  word: Word | null
}

// ---- validation: a downloaded or stored file is untrusted until it passes ---------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const optStr = (v: unknown, max = 2000): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null)
const stamp = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))
const day = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : [])

function news(v: unknown): News | null {
  if (!isObj(v) || !stamp(v.fetchedAt)) return null
  const sections: NewsSection[] = []
  for (const s of list(v.sections, 12)) {
    if (!isObj(s) || !str(s.id, 20) || !str(s.name, 40)) continue
    const items: NewsItem[] = []
    for (const i of list(s.items, 20)) {
      if (!isObj(i) || !str(i.h, 400)) continue
      items.push({ h: i.h, s: optStr(i.s, 600) ?? '', t: stamp(i.t) ? i.t : null })
    }
    sections.push({ id: s.id, name: s.name, items })
  }
  return sections.length ? { fetchedAt: v.fetchedAt, source: optStr(v.source, 80) ?? 'BBC News', sections } : null
}

function facts(v: unknown): Facts | null {
  if (!isObj(v) || !day(v.day) || !stamp(v.fetchedAt)) return null
  const items: FactItem[] = []
  for (const i of list(v.items, 20)) {
    if (!isObj(i) || !str(i.title, 200) || !str(i.fact, 600)) continue
    items.push({ title: i.title, fact: i.fact, about: optStr(i.about, 800) ?? '', category: optStr(i.category, 200) })
  }
  return items.length ? { day: v.day, fetchedAt: v.fetchedAt, source: optStr(v.source, 80) ?? 'Wikipedia', items } : null
}

function history(v: unknown): History | null {
  if (!isObj(v) || !day(v.day) || !stamp(v.fetchedAt) || !str(v.date, 5)) return null
  const items: HistoryItem[] = []
  for (const i of list(v.items, 30)) {
    if (!isObj(i) || typeof i.year !== 'number' || !Number.isInteger(i.year) || !str(i.text, 600)) continue
    items.push({ year: i.year, text: i.text })
  }
  return items.length ? { day: v.day, date: v.date, fetchedAt: v.fetchedAt, source: optStr(v.source, 80) ?? 'Wikipedia', items } : null
}

function trivia(v: unknown): Trivia | null {
  if (!isObj(v) || !day(v.day) || !stamp(v.fetchedAt) || !str(v.question, 600) || !Array.isArray(v.options)) return null
  const options = v.options.filter((o): o is string => str(o, 300)).slice(0, 6)
  if (options.length < 2 || options.length !== v.options.length) return null
  if (typeof v.answer !== 'number' || !Number.isInteger(v.answer) || v.answer < 0 || v.answer >= options.length) return null
  return { day: v.day, fetchedAt: v.fetchedAt, source: optStr(v.source, 80) ?? 'Open Trivia DB', category: optStr(v.category, 80) ?? 'General', difficulty: optStr(v.difficulty, 20) ?? '', question: v.question, options, answer: v.answer }
}

function riddle(v: unknown): Riddle | null {
  if (!isObj(v) || !day(v.day) || !stamp(v.fetchedAt) || !str(v.question, 1200) || !str(v.answer, 300)) return null
  return { day: v.day, fetchedAt: v.fetchedAt, source: optStr(v.source, 80) ?? 'API Ninjas', title: optStr(v.title, 120), question: v.question, answer: v.answer }
}

function word(v: unknown): Word | null {
  if (!isObj(v) || !day(v.day) || !stamp(v.fetchedAt) || !str(v.word, 120) || !str(v.definition, 800)) return null
  return { day: v.day, fetchedAt: v.fetchedAt, source: optStr(v.source, 80) ?? 'Wiktionary', word: v.word, partOfSpeech: optStr(v.partOfSpeech, 40), definition: v.definition, example: optStr(v.example, 500) }
}

/** Returns the checked bundle, or null if the file is not a usable Discover file at all. */
export function parseBundle(value: unknown): Bundle | null {
  if (!isObj(value) || value.schema !== SCHEMA || !stamp(value.generatedAt) || !day(value.day)) return null
  return {
    schema: SCHEMA,
    generatedAt: value.generatedAt,
    day: value.day,
    news: news(value.news),
    facts: facts(value.facts),
    history: history(value.history),
    trivia: trivia(value.trivia),
    riddle: riddle(value.riddle),
    word: word(value.word),
  }
}

// ---- storage and sync -------------------------------------------------------------------------

export function discoverUrl(): string | null {
  const explicit = import.meta.env.VITE_DISCOVER_URL as string | undefined
  if (explicit) return explicit
  const supabase = import.meta.env.VITE_SUPABASE_URL as string | undefined
  return supabase ? `${supabase.replace(/\/+$/, '')}/storage/v1/object/public/packs/discover.json` : null
}

export function readCache(): Bundle | null {
  return parseBundle(readPref<unknown>(BUNDLE_KEY))
}

export type SyncStatus = 'idle' | 'loading' | 'ok' | 'failed' | 'offline' | 'unconfigured'

async function download(url: string): Promise<Bundle> {
  const res = await fetch(url, { cache: 'no-cache', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`The content server answered ${res.status}.`)
  const text = await res.text()
  if (text.length > MAX_BYTES) throw new Error('The content file is larger than expected.')
  const bundle = parseBundle(JSON.parse(text))
  if (!bundle) throw new Error('The content file was not in the expected format.')
  return bundle
}

/** A bundle replaces the stored one only if it is not older than what is already saved. */
const newer = (a: Bundle, b: Bundle | null) => !b || Date.parse(a.generatedAt) >= Date.parse(b.generatedAt)

export interface DiscoverState {
  bundle: Bundle | null
  status: SyncStatus
  detail: string | null
  /** Milliseconds until another manual refresh is allowed (0 when allowed). */
  refresh: () => Promise<void>
}

export function useDiscover(): DiscoverState {
  const [bundle, setBundle] = useState<Bundle | null>(() => readCache())
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [detail, setDetail] = useState<string | null>(null)
  const busy = useRef(false)
  const bundleRef = useRef(bundle)
  bundleRef.current = bundle

  const run = useCallback(async (manual: boolean) => {
    const url = discoverUrl()
    if (!url) {
      setStatus('unconfigured')
      setDetail('This build has no content source.')
      return
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus('offline')
      setDetail('You are offline. Showing the last saved copy.')
      return
    }
    if (busy.current) return
    const last = readPref<number>(ATTEMPT_KEY)
    const now = Date.now()
    const minGap = manual ? MANUAL_INTERVAL_MS : AUTO_INTERVAL_MS
    if (last !== null && now - last < minGap && (bundleRef.current || !manual)) {
      if (manual) setDetail('Refreshed a moment ago. Try again in a minute.')
      return
    }
    busy.current = true
    writePref(ATTEMPT_KEY, now) // before the request: a crash or a second tab still counts as an attempt
    setStatus('loading')
    setDetail(null)
    try {
      const fresh = await download(url)
      if (newer(fresh, bundleRef.current)) {
        writePref(BUNDLE_KEY, fresh)
        setBundle(fresh)
      }
      setStatus('ok')
    } catch (e) {
      setStatus('failed')
      setDetail(e instanceof Error && e.name === 'TimeoutError' ? 'The content server did not answer in time.' : e instanceof Error ? e.message : 'The content could not be downloaded.')
    } finally {
      busy.current = false
    }
  }, [])

  // On open, then hourly while open, and again when the connection returns (each is gated by the interval).
  useEffect(() => {
    void run(false)
    const timer = window.setInterval(() => void run(false), AUTO_INTERVAL_MS)
    const onOnline = () => void run(false)
    window.addEventListener('online', onOnline)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', onOnline)
    }
  }, [run])

  return { bundle, status, detail, refresh: () => run(true) }
}

// ---- per-day interaction state (answers revealed, trivia pick) --------------------------------

export interface DayState { day: string; triviaPick: number | null; triviaRevealed: boolean; riddleRevealed: boolean }

export function readDayState(today: string): DayState {
  const v = readPref<Partial<DayState>>(STATE_KEY)
  if (v && v.day === today) {
    return { day: today, triviaPick: typeof v.triviaPick === 'number' ? v.triviaPick : null, triviaRevealed: v.triviaRevealed === true, riddleRevealed: v.riddleRevealed === true }
  }
  return { day: today, triviaPick: null, triviaRevealed: false, riddleRevealed: false }
}
export const writeDayState = (s: DayState) => writePref(STATE_KEY, s)

// ---- display helpers --------------------------------------------------------------------------

export function clock(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay ? time : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`
}

/** True if a copy is older than `hours` (shown as a "saved copy" warning, never as live). */
export const isOlderThan = (iso: string, hours: number, now = Date.now()) => now - Date.parse(iso) > hours * 3600_000

/** The UK calendar day, which is what the server uses to decide when "today's" item changes. */
export const ukToday = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
