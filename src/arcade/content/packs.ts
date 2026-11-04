// Pure content-pack format, validation and sync planning (Phase 6). No React, DOM, storage or
// network imports: the browser sync code and the admin publish tool both use this module, so what
// the tool publishes is exactly what the app accepts.
//
// A pack is one immutable JSON file per game family. A manifest (<= 8 KiB) lists the newest
// version of each pack with its size and SHA-256. Version 1 is the starter set bundled in the app,
// so published versions start at 2. Everything here is treated as untrusted input: text is only
// ever rendered as text, markup characters are rejected, sizes and counts are bounded.

import { normalizeWord } from '../games/hangman/rules.ts'
import type { Category } from './banks.ts'
import type { TriviaCategory } from './trivia.ts'
import { validateBank } from './banks.ts'
import { validateTrivia } from './trivia.ts'

export const SCHEMA_VERSION = 1
/** The bundled starter set is version 1 of every pack. */
export const STARTER_VERSION = 1
export const PACK_KEYS = ['trivia', 'words', 'charades'] as const
export type PackKey = (typeof PACK_KEYS)[number]

export const MAX_PACK_BYTES = 512 * 1024
export const MAX_MANIFEST_BYTES = 8 * 1024
export const MAX_INSTALLED_BYTES = 10 * 1024 * 1024
export const MAX_ITEMS_PER_PACK = 500
export const MAX_CATEGORIES = 20

export const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000
export const MANUAL_INTERVAL_MS = 15 * 60 * 1000

/** Which Arcade games must have no saved match before a pack may be replaced. */
export const PACK_GAMES: Record<PackKey, readonly string[]> = {
  trivia: ['trivia'],
  words: ['hangman', 'wordrush'],
  charades: ['charades'],
}

export interface Credit {
  source: string
  licence: string
  attribution: string
  url?: string
}

export interface ManifestEntry {
  key: PackKey
  version: number
  schemaVersion: number
  itemCount: number
  bytes: number
  sha256: string
  path: string
}

export interface Manifest {
  schema: number
  generatedAt: string
  packs: ManifestEntry[]
}

export type PackData =
  | { key: 'trivia'; categories: TriviaCategory[]; credits: Credit[] }
  | { key: 'words'; categories: Category[]; credits: Credit[] }
  | { key: 'charades'; categories: Category[]; credits: Credit[] }

export type Checked<T> = { ok: true; value: T } | { ok: false; reason: string }
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })

// ---- helpers ---------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
/** Plain display text: bounded, no control characters, no markup characters. */
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !CONTROL.test(v) && !/[<>]/.test(v)
const CAT_ID = /^[a-z0-9-]{1,24}$/
const ITEM_ID = /^[a-z0-9-]{1,24}:[0-9]{1,4}$/

export const isPackKey = (v: unknown): v is PackKey => typeof v === 'string' && (PACK_KEYS as readonly string[]).includes(v)
export const packPath = (key: PackKey, version: number) => `${key}-v${version}.json`

// ---- manifest --------------------------------------------------------------

export function parseManifest(text: string): Checked<Manifest> {
  if (new TextEncoder().encode(text).length > MAX_MANIFEST_BYTES) return fail('manifest too large')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return fail('manifest is not valid JSON')
  }
  if (!isObj(raw) || raw.schema !== SCHEMA_VERSION) return fail('unsupported manifest schema')
  if (typeof raw.generatedAt !== 'string' || Number.isNaN(Date.parse(raw.generatedAt))) return fail('bad generatedAt')
  if (!Array.isArray(raw.packs) || raw.packs.length > PACK_KEYS.length) return fail('bad pack list')
  const seen = new Set<string>()
  const packs: ManifestEntry[] = []
  for (const e of raw.packs as unknown[]) {
    if (!isObj(e) || !isPackKey(e.key) || seen.has(e.key)) return fail('bad or duplicate pack entry')
    seen.add(e.key)
    if (!isInt(e.version, STARTER_VERSION + 1, 1_000_000)) return fail(`${e.key}: bad version`)
    if (!isInt(e.schemaVersion, 1, 1000)) return fail(`${e.key}: bad schema version`)
    if (!isInt(e.itemCount, 1, MAX_ITEMS_PER_PACK)) return fail(`${e.key}: bad item count`)
    if (!isInt(e.bytes, 1, MAX_PACK_BYTES)) return fail(`${e.key}: pack exceeds the size budget`)
    if (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) return fail(`${e.key}: bad checksum`)
    if (e.path !== packPath(e.key, e.version)) return fail(`${e.key}: unexpected artifact path`)
    packs.push({ key: e.key, version: e.version, schemaVersion: e.schemaVersion, itemCount: e.itemCount, bytes: e.bytes, sha256: e.sha256, path: e.path })
  }
  return { ok: true, value: { schema: SCHEMA_VERSION, generatedAt: raw.generatedAt, packs } }
}

// ---- pack contents ---------------------------------------------------------

function parseCredits(raw: unknown): Checked<Credit[]> {
  if (!Array.isArray(raw) || raw.length > 20) return fail('bad credits')
  const out: Credit[] = []
  for (const c of raw as unknown[]) {
    if (!isObj(c) || !isText(c.source, 80) || !isText(c.licence, 80) || !isText(c.attribution, 200)) return fail('bad credit entry')
    if (c.url !== undefined && !(typeof c.url === 'string' && c.url.length <= 200 && /^https:\/\/[^\s<>"]+$/.test(c.url))) return fail('bad credit url')
    out.push({ source: c.source, licence: c.licence, attribution: c.attribution, ...(c.url ? { url: c.url as string } : {}) })
  }
  return { ok: true, value: out }
}

function checkCategories(raw: unknown, itemsKey: 'questions' | 'cards', minItems: number): Checked<unknown[]> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_CATEGORIES) return fail('bad categories')
  let total = 0
  const catIds = new Set<string>()
  for (const c of raw as unknown[]) {
    if (!isObj(c) || typeof c.id !== 'string' || !CAT_ID.test(c.id) || catIds.has(c.id) || !isText(c.name, 30)) return fail('bad category')
    catIds.add(c.id)
    const items = c[itemsKey]
    if (!Array.isArray(items) || items.length < minItems || items.length > MAX_ITEMS_PER_PACK) return fail(`category ${c.id}: bad item count`)
    total += items.length
    for (const it of items as unknown[]) {
      if (!isObj(it) || typeof it.id !== 'string' || !ITEM_ID.test(it.id) || !it.id.startsWith(`${c.id}:`)) return fail(`category ${c.id}: bad item id`)
    }
  }
  if (total > MAX_ITEMS_PER_PACK) return fail('too many items')
  return { ok: true, value: raw as unknown[] }
}

/** Validates an untrusted, already-parsed pack file for `key`. Returns the safe, typed contents. */
export function validatePack(key: PackKey, raw: unknown): Checked<PackData> {
  if (!isObj(raw) || raw.schema !== SCHEMA_VERSION || raw.pack !== key) return fail('wrong pack or schema')
  const credits = parseCredits(raw.credits)
  if (!credits.ok) return fail(credits.reason)

  if (key === 'trivia') {
    const cats = checkCategories(raw.categories, 'questions', 10)
    if (!cats.ok) return fail(cats.reason)
    const out: TriviaCategory[] = []
    for (const c of cats.value as { id: string; name: string; questions: Record<string, unknown>[] }[]) {
      const questions = c.questions.map((q) => {
        const w = q.w
        return { id: q.id as string, q: q.q as string, a: q.a as string, w: (Array.isArray(w) ? w : []) as [string, string, string], explanation: q.explanation as string }
      })
      for (const q of questions) {
        if (!isText(q.q, 110) || !isText(q.a, 40) || !isText(q.explanation, 160) || q.w.length !== 3 || !q.w.every((x) => isText(x, 40))) return fail(`${q.id}: bad question text`)
      }
      out.push({ id: c.id, name: c.name, questions })
    }
    const problems = validateTrivia(out)
    if (problems.length) return fail(problems[0])
    return { ok: true, value: { key, categories: out, credits: credits.value } }
  }

  const cats = checkCategories(raw.categories, 'cards', 10)
  if (!cats.ok) return fail(cats.reason)
  const out: Category[] = []
  for (const c of cats.value as { id: string; name: string; cards: Record<string, unknown>[] }[]) {
    const cards = c.cards.map((card) => ({ id: card.id as string, text: card.text as string, ...(card.meta === undefined ? {} : { meta: card.meta as string }) }))
    for (const card of cards) {
      if (!isText(card.text, 40)) return fail(`${card.id}: bad card text`)
      if (card.meta !== undefined && !isText(card.meta, 40)) return fail(`${card.id}: bad card detail`)
      // Hangman and Word Rush share the words pack: every word must be playable as a Hangman word.
      if (key === 'words') {
        const n = normalizeWord(card.text)
        if (!n.ok || n.word !== card.text.toUpperCase()) return fail(`${card.id}: not a valid Hangman word`)
      }
    }
    out.push({ id: c.id, name: c.name, cards })
  }
  const problems = validateBank(out)
  if (problems.length) return fail(problems[0])
  return { ok: true, value: { key, categories: out, credits: credits.value } as PackData }
}

/** Counts the items in a validated pack (matches the manifest's itemCount). */
export function countItems(data: PackData): number {
  return data.key === 'trivia' ? data.categories.reduce((n, c) => n + c.questions.length, 0) : data.categories.reduce((n, c) => n + c.cards.length, 0)
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Full verification of downloaded bytes against a manifest entry: size, checksum, schema, contents, count. */
export async function verifyDownload(entry: ManifestEntry, bytes: Uint8Array): Promise<Checked<PackData>> {
  if (entry.schemaVersion > SCHEMA_VERSION) return fail('pack needs a newer app')
  if (bytes.length > MAX_PACK_BYTES) return fail('pack exceeds the size budget')
  if (bytes.length !== entry.bytes) return fail('size differs from the manifest')
  if ((await sha256Hex(bytes)) !== entry.sha256) return fail('checksum mismatch')
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return fail('pack is not valid JSON')
  }
  const checked = validatePack(entry.key, raw)
  if (!checked.ok) return checked
  if (countItems(checked.value) !== entry.itemCount) return fail('item count differs from the manifest')
  return checked
}

// ---- sync planning ---------------------------------------------------------

export interface InstalledVersions {
  trivia: number
  words: number
  charades: number
}

export interface SyncPlan {
  /** Packs to download now. */
  download: ManifestEntry[]
  /** Newer packs that are not downloaded because a saved match uses the current one. */
  deferred: ManifestEntry[]
  /** Packs this app cannot read yet (newer schema). */
  unsupported: ManifestEntry[]
}

/**
 * Decides what a manifest means for this device. An unchanged manifest downloads nothing. A pack is
 * never replaced while a saved match of a game that uses it exists, never downgraded, and a pack
 * that would push the installed total over budget is skipped.
 */
export function planSync(args: {
  manifest: Manifest
  installed: InstalledVersions
  installedBytes: Record<PackKey, number>
  savedGames: ReadonlySet<string>
}): SyncPlan {
  const plan: SyncPlan = { download: [], deferred: [], unsupported: [] }
  let total = Object.values(args.installedBytes).reduce((a, b) => a + b, 0)
  for (const entry of args.manifest.packs) {
    if (entry.version <= args.installed[entry.key]) continue
    if (entry.schemaVersion > SCHEMA_VERSION) {
      plan.unsupported.push(entry)
      continue
    }
    if (PACK_GAMES[entry.key].some((g) => args.savedGames.has(g))) {
      plan.deferred.push(entry)
      continue
    }
    const projected = total - args.installedBytes[entry.key] + entry.bytes
    if (projected > MAX_INSTALLED_BYTES) continue
    total = projected
    plan.download.push(entry)
  }
  return plan
}

export function shouldAutoCheck(args: { now: number; lastAttempt: number | null; online: boolean; configured: boolean }): boolean {
  if (!args.configured || !args.online) return false
  if (args.lastAttempt === null) return true
  // A clock that moved backwards must not suppress checks forever.
  if (args.lastAttempt > args.now) return true
  return args.now - args.lastAttempt >= AUTO_INTERVAL_MS
}

export function manualRefreshWaitMs(args: { now: number; lastManual: number | null }): number {
  if (args.lastManual === null || args.lastManual > args.now) return 0
  return Math.max(0, MANUAL_INTERVAL_MS - (args.now - args.lastManual))
}
