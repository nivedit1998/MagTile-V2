// Local persistence for downloaded content packs and sync bookkeeping (IndexedDB, same database as
// game saves). Pack replacement is one transaction: the old pack is replaced whole or not at all.

import { readPref, runOnStore, writePref } from '../storage/saves'
import { type PackKey, isPackKey } from './packs'

export interface PackRecord {
  key: PackKey
  version: number
  schemaVersion: number
  sha256: string
  bytes: number
  installedAt: number
  /** The verified pack file contents exactly as published (re-validated every time it is loaded). */
  raw: unknown
}

export interface SyncMeta {
  id: 'sync'
  lastSuccess: number | null
  /** 'none' | 'updated' | 'unchanged' | 'deferred' | 'no-content' | 'failed' | 'offline' */
  lastResult: string
  lastDetail: string | null
  manifestGeneratedAt: string | null
  deferred: PackKey[]
}

export const emptyMeta = (): SyncMeta => ({ id: 'sync', lastSuccess: null, lastResult: 'none', lastDetail: null, manifestGeneratedAt: null, deferred: [] })

export async function readPacks(): Promise<PackRecord[]> {
  try {
    const all = await runOnStore<unknown[]>('packs', 'readonly', (s) => s.getAll())
    return all.filter(
      (r): r is PackRecord =>
        typeof r === 'object' && r !== null && isPackKey((r as PackRecord).key) && Number.isInteger((r as PackRecord).version) && 'raw' in (r as object),
    )
  } catch {
    return []
  }
}

/** Atomically replaces the stored pack for `record.key`. */
export async function putPack(record: PackRecord): Promise<void> {
  await runOnStore('packs', 'readwrite', (s) => s.put(record))
}

export async function readMeta(): Promise<SyncMeta> {
  try {
    const m = await runOnStore<unknown>('meta', 'readonly', (s) => s.get('sync'))
    if (typeof m === 'object' && m !== null && (m as SyncMeta).id === 'sync') return { ...emptyMeta(), ...(m as SyncMeta) }
  } catch {
    /* fall through */
  }
  return emptyMeta()
}

export async function writeMeta(meta: SyncMeta): Promise<void> {
  try {
    await runOnStore('meta', 'readwrite', (s) => s.put(meta))
  } catch {
    /* bookkeeping only */
  }
}

// Attempt times live in localStorage so every tab of this origin sees them at once and they are
// written BEFORE a network attempt (a crash mid-attempt still counts as an attempt).
const ATTEMPT_KEY = 'magtile.content.lastAttempt'
const MANUAL_KEY = 'magtile.content.lastManual'
export const readLastAttempt = (): number | null => readPref<number>(ATTEMPT_KEY)
export const writeLastAttempt = (t: number) => writePref(ATTEMPT_KEY, t)
export const readLastManual = (): number | null => readPref<number>(MANUAL_KEY)
export const writeLastManual = (t: number) => writePref(MANUAL_KEY, t)
