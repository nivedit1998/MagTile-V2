// What the games play from: the bundled starter set, replaced per pack by a verified downloaded
// pack when one is installed. Loading never touches the network. A damaged stored pack is ignored
// (the starter set is used) and reported, so a corrupt download can never break a game.

import { useEffect, useState } from 'react'
import { CHARADE_CATEGORIES, WORD_CATEGORIES, type Category } from './banks'
import { type Credit, type PackKey, STARTER_VERSION, validatePack } from './packs'
import { readMeta, readPacks, type SyncMeta } from './store'
import { TRIVIA_CATEGORIES, type TriviaCategory } from './trivia'

export interface Source {
  /** 'starter' = bundled in the app (version 1); 'downloaded' = an installed pack. */
  origin: 'starter' | 'downloaded'
  version: number
  installedAt: number | null
  credits: Credit[]
}

export interface ContentSet {
  trivia: Source & { categories: readonly TriviaCategory[] }
  words: Source & { categories: readonly Category[] }
  charades: Source & { categories: readonly Category[] }
  /** Packs found in storage but rejected on load. */
  damaged: PackKey[]
  meta: SyncMeta
}

export const STARTER_CREDITS: Credit[] = [
  {
    source: 'MagTile starter set',
    licence: 'Original content written for MagTile',
    attribution: 'Questions, words and action phrases by the MagTile project. Film and show entries are factual titles with year and language only.',
  },
]

const starter = (): Source => ({ origin: 'starter', version: STARTER_VERSION, installedAt: null, credits: STARTER_CREDITS })

let cached: Promise<ContentSet> | null = null

export function invalidateContent(): void {
  cached = null
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('magtile-content-changed'))
}

export function loadContent(): Promise<ContentSet> {
  if (!cached) cached = build()
  return cached
}

async function build(): Promise<ContentSet> {
  const set: ContentSet = {
    trivia: { ...starter(), categories: TRIVIA_CATEGORIES },
    words: { ...starter(), categories: WORD_CATEGORIES },
    charades: { ...starter(), categories: CHARADE_CATEGORIES },
    damaged: [],
    meta: await readMeta(),
  }
  for (const rec of await readPacks()) {
    const checked = rec.version > STARTER_VERSION ? validatePack(rec.key, rec.raw) : { ok: false as const, reason: 'bad version' }
    if (!checked.ok) {
      set.damaged.push(rec.key)
      continue
    }
    const base: Source = { origin: 'downloaded', version: rec.version, installedAt: rec.installedAt, credits: checked.value.credits }
    if (checked.value.key === 'trivia') set.trivia = { ...base, categories: checked.value.categories }
    else if (checked.value.key === 'words') set.words = { ...base, categories: checked.value.categories }
    else set.charades = { ...base, categories: checked.value.categories }
  }
  return set
}

/** The content for a game screen; null while loading (a few milliseconds from local storage). */
export function useContent(follow = false): ContentSet | null {
  const [content, setContent] = useState<ContentSet | null>(null)
  useEffect(() => {
    let live = true
    const refresh = () => loadContent().then((c) => live && setContent(c))
    void refresh()
    // A game takes one snapshot when it opens and keeps it until it is closed, so a pack installed
    // later can never change the content of a match that is already running. Menu screens follow.
    if (follow) window.addEventListener('magtile-content-changed', refresh)
    return () => {
      live = false
      if (follow) window.removeEventListener('magtile-content-changed', refresh)
    }
  }, [follow])
  return content
}
