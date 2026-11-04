// Focused deterministic checks for the content-pack format, verification and sync planning.
// Run:  node src/arcade/content/packs.check.ts   (non-zero exit on failure)
import { CHARADE_CATEGORIES, WORD_CATEGORIES } from './banks.ts'
import { TRIVIA_CATEGORIES } from './trivia.ts'
import {
  AUTO_INTERVAL_MS, MANUAL_INTERVAL_MS, MAX_INSTALLED_BYTES, MAX_PACK_BYTES, SCHEMA_VERSION, countItems, manualRefreshWaitMs, packPath, parseManifest, planSync,
  sha256Hex, shouldAutoCheck, validatePack, verifyDownload, type InstalledVersions, type ManifestEntry, type PackKey,
} from './packs.ts'

let checks = 0
function check(name: string, ok: boolean): void {
  checks += 1
  if (!ok) throw new Error(`FAILED: ${name}`)
}

const credits = [{ source: 'Test', licence: 'Original', attribution: 'Test content' }]
const sources: Record<PackKey, unknown> = {
  trivia: { schema: 1, pack: 'trivia', credits, categories: TRIVIA_CATEGORIES },
  words: { schema: 1, pack: 'words', credits, categories: WORD_CATEGORIES },
  charades: { schema: 1, pack: 'charades', credits, categories: CHARADE_CATEGORIES },
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const enc = (x: unknown) => new TextEncoder().encode(JSON.stringify(x))

async function entryFor(key: PackKey, version: number, src: unknown = sources[key]): Promise<{ entry: ManifestEntry; bytes: Uint8Array }> {
  const bytes = enc(src)
  const checked = validatePack(key, src)
  if (!checked.ok) throw new Error(checked.reason)
  return { entry: { key, version, schemaVersion: SCHEMA_VERSION, itemCount: countItems(checked.value), bytes: bytes.length, sha256: await sha256Hex(bytes), path: packPath(key, version) }, bytes }
}

// 1. Starter sets pass the pack validators (so the publish tool can ship them as v2).
for (const key of ['trivia', 'words', 'charades'] as PackKey[]) check(`${key}: starter set is a valid pack`, validatePack(key, clone(sources[key])).ok)
check('item counts', countItems((validatePack('trivia', sources.trivia) as { ok: true; value: Parameters<typeof countItems>[0] }).value) === 60)
check('every starter pack is within the 512 KiB budget', ['trivia', 'words', 'charades'].every((k) => enc(sources[k as PackKey]).length < MAX_PACK_BYTES))

// 2. Pack validation rejects hostile or broken content.
{
  const t = (mut: (p: { categories: { id: string; questions: Record<string, unknown>[] }[] }) => void) => {
    const p = clone(sources.trivia) as { categories: { id: string; questions: Record<string, unknown>[] }[] }
    mut(p)
    return validatePack('trivia', p).ok
  }
  check('trivia: markup in text rejected', !t((p) => { p.categories[0].questions[0].q = '<img src=x onerror=alert(1)>' }) && !t((p) => { p.categories[0].questions[0].a = 'a<b' }) && !t((p) => { p.categories[0].questions[0].explanation = '</p>' }))
  check('trivia: control characters, empty and oversized text rejected', !t((p) => { p.categories[0].questions[0].q = 'bad\u0007text' }) && !t((p) => { p.categories[0].questions[0].a = '   ' }) && !t((p) => { p.categories[0].questions[0].q = 'x'.repeat(111) }) && !t((p) => { p.categories[0].questions[0].explanation = 'x'.repeat(161) }))
  check('trivia: wrong option count, duplicate options, missing fields rejected', !t((p) => { p.categories[0].questions[0].w = ['a', 'b'] }) && !t((p) => { p.categories[0].questions[0].w = ['same', 'same', 'x'] }) && !t((p) => { delete p.categories[0].questions[0].w }) && !t((p) => { delete p.categories[0].questions[0].explanation }))
  check('trivia: bad / foreign / duplicate ids rejected', !t((p) => { p.categories[0].questions[0].id = 'nope' }) && !t((p) => { p.categories[0].questions[0].id = 'other:1' }) && !t((p) => { p.categories[0].questions[1].id = p.categories[0].questions[0].id }))
  check('trivia: category with fewer than 10 questions, bad category id, no categories rejected', !t((p) => { p.categories[0].questions.length = 5 }) && !t((p) => { p.categories[0].id = 'Bad Id!' }) && !t((p) => { p.categories.length = 0 }))
  check('wrong pack key / schema rejected', !validatePack('words', sources.trivia).ok && !validatePack('trivia', { ...(sources.trivia as object), schema: 2 }).ok && !validatePack('trivia', null).ok && !validatePack('trivia', 'x').ok && !validatePack('trivia', []).ok)
  check('credits must be well-formed, https links only', !validatePack('trivia', { ...(sources.trivia as object), credits: [{ source: 'a' }] }).ok && !validatePack('trivia', { ...(sources.trivia as object), credits: [{ ...credits[0], url: 'javascript:alert(1)' }] }).ok && validatePack('trivia', { ...(sources.trivia as object), credits: [{ ...credits[0], url: 'https://example.org/licence' }] }).ok)
  const w = (mut: (p: { categories: { cards: Record<string, unknown>[] }[] }) => void) => { const p = clone(sources.words) as { categories: { cards: Record<string, unknown>[] }[] }; mut(p); return validatePack('words', p).ok }
  check('words: every word must be playable in Hangman (letters only), markup rejected', !w((p) => { p.categories[0].cards[0].text = 'Word2' }) && !w((p) => { p.categories[0].cards[0].text = 'x<y' }) && !w((p) => { p.categories[0].cards[0].text = 'Aaa' }))
  const c = (mut: (p: { categories: { cards: Record<string, unknown>[] }[] }) => void) => { const p = clone(sources.charades) as { categories: { cards: Record<string, unknown>[] }[] }; mut(p); return validatePack('charades', p).ok }
  check('charades: detail text is validated too', c((p) => { p.categories[1].cards[0].meta = '1999 · English' }) && !c((p) => { p.categories[1].cards[0].meta = '<b>' }) && !c((p) => { p.categories[1].cards[0].text = 'x'.repeat(41) }))
}

// 3. Manifest parsing.
{
  const a = await entryFor('trivia', 2)
  const good = JSON.stringify({ schema: 1, generatedAt: '2026-11-04T00:00:00Z', packs: [a.entry] })
  check('good manifest parses', parseManifest(good).ok)
  const bad = (m: unknown) => !parseManifest(JSON.stringify(m)).ok
  const base = { schema: 1, generatedAt: '2026-11-04T00:00:00Z', packs: [a.entry] }
  check('manifest: bad schema, date, shape rejected', bad({ ...base, schema: 2 }) && bad({ ...base, generatedAt: 'nope' }) && bad({ ...base, packs: 'x' }) && !parseManifest('not json').ok && !parseManifest('[]').ok)
  check('manifest: version 1 (the bundled starter), huge, zero rejected', bad({ ...base, packs: [{ ...a.entry, version: 1, path: packPath('trivia', 1) }] }) && bad({ ...base, packs: [{ ...a.entry, bytes: MAX_PACK_BYTES + 1 }] }) && bad({ ...base, packs: [{ ...a.entry, itemCount: 0 }] }))
  check('manifest: bad checksum, unexpected path (traversal), unknown pack, duplicate rejected', bad({ ...base, packs: [{ ...a.entry, sha256: 'xyz' }] }) && bad({ ...base, packs: [{ ...a.entry, path: '../trivia-v2.json' }] }) && bad({ ...base, packs: [{ ...a.entry, path: 'other-v2.json' }] }) && bad({ ...base, packs: [{ ...a.entry, key: 'secrets' }] }) && bad({ ...base, packs: [a.entry, a.entry] }))
  check('manifest over 8 KiB rejected', !parseManifest(JSON.stringify({ ...base, pad: 'x'.repeat(9000) })).ok)
}

// 4. Download verification: size, checksum, JSON, contents, count, schema.
{
  const { entry, bytes } = await entryFor('words', 3)
  check('exact bytes verify', (await verifyDownload(entry, bytes)).ok)
  const flipped = bytes.slice(); flipped[10] ^= 1
  check('a flipped byte fails the checksum (same size)', !(await verifyDownload(entry, flipped)).ok)
  check('a truncated or extended file fails the size check', !(await verifyDownload(entry, bytes.slice(0, bytes.length - 1))).ok && !(await verifyDownload(entry, new Uint8Array([...bytes, 32]))).ok)
  check('declared size over the budget is rejected before hashing', !(await verifyDownload({ ...entry, bytes: MAX_PACK_BYTES + 1 }, new Uint8Array(MAX_PACK_BYTES + 1))).ok)
  const notJson = new TextEncoder().encode('{nope');
  check('invalid JSON with a matching checksum is rejected', !(await verifyDownload({ ...entry, bytes: notJson.length, sha256: await sha256Hex(notJson) }, notJson)).ok)
  const evil = clone(sources.words) as { categories: { cards: Record<string, unknown>[] }[] }; evil.categories[0].cards[0].text = '<script>'
  const evilBytes = enc(evil)
  check('well-formed hashes cannot launder bad contents', !(await verifyDownload({ ...entry, bytes: evilBytes.length, sha256: await sha256Hex(evilBytes) }, evilBytes)).ok)
  check('item count must match the manifest', !(await verifyDownload({ ...entry, itemCount: entry.itemCount + 1 }, bytes)).ok)
  check('a pack for a newer schema is not accepted by this app', !(await verifyDownload({ ...entry, schemaVersion: SCHEMA_VERSION + 1 }, bytes)).ok)
  check('a pack presented under the wrong key is rejected', !(await verifyDownload({ ...entry, key: 'trivia' }, bytes)).ok)
}

// 5. Sync planning.
{
  const e = async (key: PackKey, v: number, bytes = 1000): Promise<ManifestEntry> => ({ ...(await entryFor(key, v)).entry, bytes })
  const manifest = { schema: 1, generatedAt: '2026-11-04T00:00:00Z', packs: [await e('trivia', 2), await e('words', 2), await e('charades', 2)] }
  const installed: InstalledVersions = { trivia: 1, words: 1, charades: 1 }
  const zeros = { trivia: 0, words: 0, charades: 0 }
  const none = new Set<string>()
  check('new packs are downloaded', planSync({ manifest, installed, installedBytes: zeros, savedGames: none }).download.length === 3)
  check('an unchanged manifest downloads nothing', planSync({ manifest, installed: { trivia: 2, words: 2, charades: 2 }, installedBytes: zeros, savedGames: none }).download.length === 0)
  check('only changed packs are downloaded', planSync({ manifest, installed: { trivia: 2, words: 1, charades: 2 }, installedBytes: zeros, savedGames: none }).download.map((x) => x.key).join() === 'words')
  check('never downgrades', planSync({ manifest, installed: { trivia: 5, words: 5, charades: 5 }, installedBytes: zeros, savedGames: none }).download.length === 0)
  const blocked = planSync({ manifest, installed, installedBytes: zeros, savedGames: new Set(['hangman']) })
  check('a saved Hangman game defers the words pack only (it is shared with Word Rush)', blocked.download.map((x) => x.key).sort().join() === 'charades,trivia' && blocked.deferred.map((x) => x.key).join() === 'words')
  check('a saved Trivia / Charades / Word Rush game defers its own pack', planSync({ manifest, installed, installedBytes: zeros, savedGames: new Set(['trivia']) }).deferred.map((x) => x.key).join() === 'trivia' && planSync({ manifest, installed, installedBytes: zeros, savedGames: new Set(['charades']) }).deferred.map((x) => x.key).join() === 'charades' && planSync({ manifest, installed, installedBytes: zeros, savedGames: new Set(['wordrush']) }).deferred.map((x) => x.key).join() === 'words')
  check('games that do not use packs never block (Tic-Tac-Toe, Undercover...)', planSync({ manifest, installed, installedBytes: zeros, savedGames: new Set(['tictactoe', 'minesweeper', 'undercover', 'mafia', 'battleships', 'nonograms']) }).download.length === 3)
  const newer = { ...manifest, packs: [{ ...manifest.packs[0], schemaVersion: SCHEMA_VERSION + 1 }] }
  check('newer-schema packs are reported, not downloaded', planSync({ manifest: newer, installed, installedBytes: zeros, savedGames: none }).unsupported.length === 1 && planSync({ manifest: newer, installed, installedBytes: zeros, savedGames: none }).download.length === 0)
  const huge = { ...manifest, packs: [{ ...manifest.packs[0], bytes: MAX_PACK_BYTES }] }
  check('a pack that would exceed the installed budget is skipped', planSync({ manifest: huge, installed, installedBytes: { trivia: 0, words: MAX_INSTALLED_BYTES, charades: 0 }, savedGames: none }).download.length === 0)
}

// 6. Scheduling.
{
  const now = 1_000_000_000_000
  check('auto check: first ever visit, online and configured', shouldAutoCheck({ now, lastAttempt: null, online: true, configured: true }))
  check('auto check: never when offline or not configured', !shouldAutoCheck({ now, lastAttempt: null, online: false, configured: true }) && !shouldAutoCheck({ now, lastAttempt: null, online: true, configured: false }))
  check('auto check: not again within 24 h (even after a failure), yes after', !shouldAutoCheck({ now, lastAttempt: now - AUTO_INTERVAL_MS + 1, online: true, configured: true }) && shouldAutoCheck({ now, lastAttempt: now - AUTO_INTERVAL_MS, online: true, configured: true }))
  check('auto check: a clock that went backwards does not block checks forever', shouldAutoCheck({ now, lastAttempt: now + 10 * AUTO_INTERVAL_MS, online: true, configured: true }))
  check('manual refresh: allowed first time and after 15 minutes, throttled before', manualRefreshWaitMs({ now, lastManual: null }) === 0 && manualRefreshWaitMs({ now, lastManual: now - MANUAL_INTERVAL_MS }) === 0 && manualRefreshWaitMs({ now, lastManual: now - 60_000 }) === MANUAL_INTERVAL_MS - 60_000 && manualRefreshWaitMs({ now, lastManual: now + 5 }) === 0)
}

console.log(`packs.check: ${checks} checks passed`)
