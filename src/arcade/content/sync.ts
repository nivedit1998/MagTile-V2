// Sparse content sync (browser side). Runs only from the Arcade menu, never during a game.
//
//  - Auto check: at most once per rolling 24 h per device, when online, on the first menu visit; the
//    attempt time is written BEFORE the request and shared across tabs (localStorage + Web Locks).
//  - Manual refresh: explicit, throttled to once per 15 minutes.
//  - One tiny manifest request; packs are fetched only when the manifest lists a newer version.
//    An unchanged manifest downloads nothing.
//  - Every download is verified (size, SHA-256, schema, contents) before an atomic replacement. Any
//    failure keeps the last good pack (or the bundled starter set) and is not retried until the next
//    eligible check: there is no retry loop and no background polling.
//  - A pack is never replaced while a saved match of a game that uses it exists.
//  - Nothing here sends user data: requests are anonymous GETs for public files.

import { listSavedIds } from '../storage/saves'
import {
  MAX_MANIFEST_BYTES, MAX_PACK_BYTES, PACK_KEYS, STARTER_VERSION, PACK_GAMES, manualRefreshWaitMs, parseManifest, planSync, shouldAutoCheck, validatePack, verifyDownload,
  type InstalledVersions, type ManifestEntry, type PackKey,
} from './packs'
import { invalidateContent } from './runtime'
import { putPack, readLastAttempt, readLastManual, readMeta, readPacks, writeLastAttempt, writeLastManual, writeMeta } from './store'

const TIMEOUT_MS = 10_000
const LOCK_NAME = 'magtile-content-sync'

/** Where the manifest lives, or null when this build has no content source (sync is then off). */
export function manifestUrl(): string | null {
  const explicit = import.meta.env.VITE_CONTENT_MANIFEST_URL as string | undefined
  if (explicit) return explicit
  const supabase = import.meta.env.VITE_SUPABASE_URL as string | undefined
  return supabase ? `${supabase.replace(/\/+$/, '')}/storage/v1/object/public/packs/manifest.json` : null
}

export type SyncKind = 'auto' | 'manual'
export interface SyncOutcome {
  result: 'updated' | 'unchanged' | 'deferred' | 'no-content' | 'failed' | 'offline' | 'busy' | 'unconfigured' | 'throttled' | 'skipped'
  detail: string | null
  updated: PackKey[]
  deferred: PackKey[]
  /** Milliseconds until a manual refresh is allowed again (throttled). */
  waitMs?: number
}

const done = (result: SyncOutcome['result'], detail: string | null = null, extra: Partial<SyncOutcome> = {}): SyncOutcome => ({ result, detail, updated: [], deferred: [], ...extra })

/** Reads at most `max` bytes of a response body; throws if the body is larger. */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) throw new Error('response is larger than the size budget')
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.length > max) throw new Error('response is larger than the size budget')
    return buf
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done: end, value } = await reader.read()
    if (end) break
    total += value.length
    if (total > max) {
      await reader.cancel()
      throw new Error('response is larger than the size budget')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

async function get(url: string): Promise<Response> {
  return fetch(url, { cache: 'no-cache', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(TIMEOUT_MS) })
}

async function savedGameSet(): Promise<Set<string>> {
  return new Set(await listSavedIds())
}

async function attempt(url: string): Promise<SyncOutcome> {
  let manifestText: string
  const res = await get(url)
  if (res.status === 404 || res.status === 400) return done('no-content', 'No content has been published yet.')
  if (!res.ok) return done('failed', `The content server answered ${res.status}.`)
  manifestText = new TextDecoder().decode(await readCapped(res, MAX_MANIFEST_BYTES))
  const manifest = parseManifest(manifestText)
  if (!manifest.ok) return done('failed', `The content list was rejected: ${manifest.reason}.`)

  const records = await readPacks()
  const installed: InstalledVersions = { trivia: STARTER_VERSION, words: STARTER_VERSION, charades: STARTER_VERSION }
  const installedBytes: Record<PackKey, number> = { trivia: 0, words: 0, charades: 0 }
  for (const r of records) {
    // A stored pack that no longer validates is ignored by the games, so it counts as not installed:
    // the next refresh can repair it instead of being blocked by its version number.
    if (r.version <= STARTER_VERSION || !validatePack(r.key, r.raw).ok) continue
    installed[r.key] = Math.max(installed[r.key], r.version)
    installedBytes[r.key] = r.bytes
  }
  const plan = planSync({ manifest: manifest.value, installed, installedBytes, savedGames: await savedGameSet() })

  const base = url.slice(0, url.lastIndexOf('/') + 1)
  const updated: PackKey[] = []
  const deferred: PackKey[] = plan.deferred.map((e) => e.key)
  const failures: string[] = []
  for (const entry of plan.download) {
    try {
      const pr = await get(`${base}${entry.path}`)
      if (!pr.ok) throw new Error(`HTTP ${pr.status}`)
      const bytes = await readCapped(pr, Math.min(MAX_PACK_BYTES, entry.bytes))
      const checked = await verifyDownload(entry, bytes)
      if (!checked.ok) throw new Error(checked.reason)
      // A match may have been started since the plan was made: re-check right before replacing.
      const blockedNow = [...(await savedGameSet())].some((g) => PACK_GAMES[entry.key].includes(g))
      if (blockedNow) {
        deferred.push(entry.key)
        continue
      }
      await putPack({ key: entry.key, version: entry.version, schemaVersion: entry.schemaVersion, sha256: entry.sha256, bytes: entry.bytes, installedAt: Date.now(), raw: JSON.parse(new TextDecoder().decode(bytes)) })
      updated.push(entry.key)
    } catch (e) {
      failures.push(`${entry.key}: ${e instanceof Error ? e.message : 'download failed'}`)
    }
  }
  if (updated.length) invalidateContent()
  const meta = await readMeta()
  const next = {
    ...meta,
    lastResult: failures.length ? 'failed' : updated.length ? 'updated' : deferred.length ? 'deferred' : 'unchanged',
    lastDetail: failures.length ? failures.join('; ') : null,
    manifestGeneratedAt: manifest.value.generatedAt,
    deferred,
    ...(failures.length ? {} : { lastSuccess: Date.now() }),
  }
  await writeMeta(next)
  if (updated.length || failures.length) invalidateContent() // lets the menu show the new status
  if (failures.length) return done('failed', failures.join('; '), { updated, deferred })
  return done(updated.length ? 'updated' : deferred.length ? 'deferred' : 'unchanged', null, { updated, deferred })
}

/** Runs one sync attempt if allowed. Safe to call repeatedly: the checks below stop duplicates and bursts. */
export async function runSync(kind: SyncKind): Promise<SyncOutcome> {
  const url = manifestUrl()
  if (!url) return done('unconfigured', 'This build has no content source.')
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return done('offline', 'You are offline. Saved content is in use.')

  const gate = (): SyncOutcome | null => {
    const now = Date.now()
    if (kind === 'auto') return shouldAutoCheck({ now, lastAttempt: readLastAttempt(), online: true, configured: true }) ? null : done('skipped')
    const wait = manualRefreshWaitMs({ now, lastManual: readLastManual() })
    return wait > 0 ? done('throttled', null, { waitMs: wait }) : null
  }
  const blocked = gate()
  if (blocked) return blocked

  const body = async (): Promise<SyncOutcome> => {
    // Re-check inside the lock: another tab may have just attempted.
    const again = gate()
    if (again) return again
    const now = Date.now()
    writeLastAttempt(now) // before the request, so a crash or a second tab still counts it
    if (kind === 'manual') writeLastManual(now)
    try {
      const outcome = await attempt(url)
      if (outcome.result === 'failed' || outcome.result === 'no-content') {
        // Rejected manifests and HTTP errors never reach the pack stage; record them here so the
        // Content screen always reports the real last attempt.
        const meta = await readMeta()
        await writeMeta({ ...meta, lastResult: outcome.result, lastDetail: outcome.detail })
        invalidateContent()
      }
      return outcome
    } catch (e) {
      const meta = await readMeta()
      const detail = e instanceof Error && e.name === 'TimeoutError' ? 'The content server did not answer in time.' : 'The content server could not be reached.'
      await writeMeta({ ...meta, lastResult: 'failed', lastDetail: detail })
      invalidateContent()
      return done('failed', detail)
    }
  }

  if (typeof navigator !== 'undefined' && navigator.locks) {
    const out = await navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => (lock ? body() : done('busy', 'Another tab is already checking.')))
    return out
  }
  return body()
}

export { PACK_KEYS }
export type { ManifestEntry }
