// Versioned local game saves. IndexedDB first, in-memory fallback with a visible flag.
// Nothing here touches the network. Saves never leave the device.

export const SAVE_SCHEMA_VERSION = 1
const DB_NAME = 'magtile-arcade'
const DB_VERSION = 2 // v2 adds the content stores (packs, meta); the saves store is unchanged
const STORE = 'saves'

export interface SaveEnvelope {
  schemaVersion: number
  gameId: string
  gameVersion: number
  sessionId: string
  updatedAt: number
  settings: unknown
  state: unknown
}

export type ReadResult =
  | { kind: 'none' }
  | { kind: 'found'; envelope: SaveEnvelope }
  | { kind: 'bad'; reason: string }

const memory = new Map<string, SaveEnvelope>()
let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'))
      return
    }
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (e) {
      reject(e)
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'gameId' })
      if (!db.objectStoreNames.contains('packs')) db.createObjectStore('packs', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' })
    }
    req.onsuccess = () => {
      const db = req.result
      // Let a newer tab/version (or the user clearing site data) proceed instead of blocking it.
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      // The browser closed the connection (eviction, storage cleared): reopen on next use.
      db.onclose = () => {
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onblocked = () => reject(new Error('IndexedDB open blocked'))
  }).catch((e) => {
    dbPromise = null // allow a later retry
    throw e
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        tx.oncomplete = () => resolve(req.result)
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
      }),
  )
}

function checkEnvelope(raw: unknown, gameId: string, gameVersion: number): SaveEnvelope | string {
  if (typeof raw !== 'object' || raw === null) return 'The saved data is not readable.'
  const e = raw as Record<string, unknown>
  if (e.schemaVersion !== SAVE_SCHEMA_VERSION) return 'The save was made by a different app version.'
  if (e.gameId !== gameId) return 'The save belongs to another game.'
  if (e.gameVersion !== gameVersion) return 'The save was made by a different game version.'
  if (typeof e.sessionId !== 'string' || typeof e.updatedAt !== 'number') return 'The saved data is incomplete.'
  if (!('settings' in e) || !('state' in e)) return 'The saved data is incomplete.'
  return raw as SaveEnvelope
}

/** Reads one game's save. Storage failure reads as "none" (and falls back to memory). */
export async function readSave(gameId: string, gameVersion: number): Promise<ReadResult> {
  let raw: unknown
  try {
    raw = await run<unknown>('readonly', (s) => s.get(gameId))
  } catch {
    raw = memory.get(gameId)
  }
  if (raw === undefined || raw === null) return { kind: 'none' }
  const checked = checkEnvelope(raw, gameId, gameVersion)
  return typeof checked === 'string' ? { kind: 'bad', reason: checked } : { kind: 'found', envelope: checked }
}

/** Writes a save. Returns true when it reached durable storage, false when only held in memory. */
export async function writeSave(envelope: SaveEnvelope): Promise<boolean> {
  memory.set(envelope.gameId, envelope)
  try {
    await run('readwrite', (s) => s.put(envelope))
    return true
  } catch {
    return false
  }
}

export async function removeSave(gameId: string): Promise<void> {
  memory.delete(gameId)
  try {
    await run('readwrite', (s) => s.delete(gameId))
  } catch {
    /* nothing durable to remove */
  }
}

/** Game ids that currently have any save (used for the Arcade list marker). */
export async function listSavedIds(): Promise<string[]> {
  try {
    const keys = await run<IDBValidKey[]>('readonly', (s) => s.getAllKeys())
    return keys.map(String)
  } catch {
    return [...memory.keys()]
  }
}

// Small public preferences (not game state).
export function readPref<T>(key: string): T | null {
  try {
    const v = window.localStorage.getItem(key)
    return v === null ? null : (JSON.parse(v) as T)
  } catch {
    return null
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* preferences are optional */
  }
}

/** Runs one request against any store in the shared Arcade database (used by the content store). */
export function runOnStore<T>(store: 'saves' | 'packs' | 'meta', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode)
        const req = fn(tx.objectStore(store))
        tx.oncomplete = () => resolve(req.result)
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
      }),
  )
}
