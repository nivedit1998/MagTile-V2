#!/usr/bin/env node
// MagTile Arcade content publisher (admin tool). Run by an owner/admin, never by the app.
//
//   node tools/content/publish.mjs build  --out <dir> [--version N] [--input <dir>]
//   node tools/content/publish.mjs export-starters --out <dir>
//   node tools/content/publish.mjs publish --out <dir> --apply        (needs env, see below)
//   node tools/content/publish.mjs seed-items --apply                  (needs env, see below)
//
// `build` is a dry run: it validates and writes pack files and manifest.json into <dir>. Nothing leaves
// this computer. `publish` and `seed-items` only touch the hosted project when you pass --apply AND set
//   SUPABASE_URL                (https://<ref>.supabase.co)
//   SUPABASE_SERVICE_ROLE_KEY   (server secret: keep out of the repo, shell history and logs)
// The key is read from the environment and never printed. Publication order keeps devices safe:
// pack files first (create-only, never overwritten), then the pack rows, then manifest.json last.
//
// Content comes from the bundled starter set unless --input points at a folder with trivia.json,
// words.json and charades.json in the pack source format (see packs.ts). Imported third-party content
// is NOT enabled: verify terms, attribution and redistribution rights first (see ARCADE_IMPLEMENTATION_PLAN).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { CHARADE_CATEGORIES, WORD_CATEGORIES } from '../../src/arcade/content/banks.ts'
import { TRIVIA_CATEGORIES } from '../../src/arcade/content/trivia.ts'
import {
  MAX_INSTALLED_BYTES, MAX_MANIFEST_BYTES, MAX_PACK_BYTES, PACK_KEYS, SCHEMA_VERSION, STARTER_VERSION, countItems, packPath, parseManifest, sha256Hex,
  validatePack, verifyDownload,
} from '../../src/arcade/content/packs.ts'

const STARTER_CREDITS = [
  {
    source: 'MagTile starter set',
    licence: 'Original content written for MagTile',
    attribution: 'Questions, words and action phrases by the MagTile project. Film and show entries are factual titles with year and language only.',
  },
]

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const flag = (name) => process.argv.includes(`--${name}`)
const die = (msg) => {
  console.error(`error: ${msg}`)
  process.exit(1)
}

function starterSources() {
  return {
    trivia: { schema: SCHEMA_VERSION, pack: 'trivia', credits: STARTER_CREDITS, categories: TRIVIA_CATEGORIES },
    words: { schema: SCHEMA_VERSION, pack: 'words', credits: STARTER_CREDITS, categories: WORD_CATEGORIES },
    charades: { schema: SCHEMA_VERSION, pack: 'charades', credits: STARTER_CREDITS, categories: CHARADE_CATEGORIES },
  }
}

function loadSources(inputDir) {
  if (!inputDir) return starterSources()
  const out = {}
  for (const key of PACK_KEYS) {
    const file = join(resolve(inputDir), `${key}.json`)
    if (!existsSync(file)) die(`missing ${file}`)
    out[key] = JSON.parse(readFileSync(file, 'utf8'))
  }
  return out
}

async function build(outDir, version, inputDir) {
  if (!Number.isInteger(version) || version <= STARTER_VERSION) die(`--version must be an integer greater than ${STARTER_VERSION} (version ${STARTER_VERSION} is the bundled starter set)`)
  mkdirSync(outDir, { recursive: true })
  const sources = loadSources(inputDir)
  const entries = []
  let total = 0
  for (const key of PACK_KEYS) {
    const checked = validatePack(key, sources[key])
    if (!checked.ok) die(`${key}: ${checked.reason}`)
    const text = JSON.stringify({ schema: SCHEMA_VERSION, pack: key, credits: checked.value.credits, categories: checked.value.categories })
    const bytes = new TextEncoder().encode(text)
    if (bytes.length > MAX_PACK_BYTES) die(`${key}: ${bytes.length} bytes exceeds the ${MAX_PACK_BYTES} byte budget`)
    const entry = { key, version, schemaVersion: SCHEMA_VERSION, itemCount: countItems(checked.value), bytes: bytes.length, sha256: await sha256Hex(bytes), path: packPath(key, version) }
    // Re-verify exactly what a device will verify.
    const again = await verifyDownload(entry, bytes)
    if (!again.ok) die(`${key}: self-check failed: ${again.reason}`)
    writeFileSync(join(outDir, entry.path), bytes)
    entries.push({ ...entry, gzip: gzipSync(bytes).length, credits: checked.value.credits })
    total += bytes.length
  }
  if (total > MAX_INSTALLED_BYTES) die(`total ${total} bytes exceeds the installed budget`)
  const manifest = { schema: SCHEMA_VERSION, generatedAt: new Date().toISOString(), packs: entries.map(({ gzip: _g, credits: _c, ...e }) => e) }
  const manifestText = JSON.stringify(manifest)
  const m = parseManifest(manifestText)
  if (!m.ok) die(`manifest self-check failed: ${m.reason}`)
  if (new TextEncoder().encode(manifestText).length > MAX_MANIFEST_BYTES) die('manifest exceeds 8 KiB')
  writeFileSync(join(outDir, 'manifest.json'), manifestText)
  writeFileSync(join(outDir, 'publication.json'), JSON.stringify(entries))
  console.log(`built version ${version} into ${resolve(outDir)} (dry run, nothing uploaded)`)
  for (const e of entries) console.log(`  ${e.path}: ${e.itemCount} items, ${e.bytes} bytes (${e.gzip} gzip), sha256 ${e.sha256.slice(0, 12)}...`)
  console.log(`  manifest.json: ${new TextEncoder().encode(manifestText).length} bytes; total packs ${total} bytes`)
}

function remote() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) die('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for --apply (values are never printed)')
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) die('SUPABASE_URL does not look like a Supabase project or a local stack')
  const headers = { apikey: key, Authorization: `Bearer ${key}` }
  return { url, headers }
}

async function must(res, what) {
  if (!res.ok) die(`${what} failed with HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res
}

async function publish(outDir) {
  if (!flag('apply')) die('refusing to publish without --apply (run `build` first and review the output)')
  const { url, headers } = remote()
  const entries = JSON.parse(readFileSync(join(outDir, 'publication.json'), 'utf8'))
  for (const e of entries) {
    const bytes = readFileSync(join(outDir, e.path))
    // Create-only: an existing object is never overwritten (published packs are immutable).
    // If a previous run uploaded this file but stopped before registering it, resume only when the
    // stored bytes are identical (same SHA-256); otherwise stop.
    const up = await fetch(`${url}/storage/v1/object/packs/${e.path}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'x-upsert': 'false' }, body: bytes })
    if (!up.ok) {
      const text = await up.text()
      if (!/Duplicate|already exists/i.test(text)) die(`upload ${e.path} failed with HTTP ${up.status}: ${text.slice(0, 200)}`)
      const existing = new Uint8Array(await (await fetch(`${url}/storage/v1/object/public/packs/${e.path}`, { cache: 'no-store' })).arrayBuffer())
      if ((await sha256Hex(existing)) !== e.sha256) die(`${e.path} already exists with DIFFERENT contents; publish a new version instead`)
      console.log(`${e.path} already uploaded with identical contents; continuing`)
    }
    await must(
      await fetch(`${url}/rest/v1/content_packs`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ pack_key: e.key, version: e.version, schema_version: e.schemaVersion, item_count: e.itemCount, byte_size: e.bytes, gzip_size: e.gzip, checksum_sha256: e.sha256, artifact_path: e.path, credits: e.credits }),
      }),
      `register ${e.path}`,
    )
    console.log(`published ${e.path}`)
  }
  // The manifest goes last and may be replaced: devices only ever see packs that already exist.
  await must(await fetch(`${url}/storage/v1/object/packs/manifest.json`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'max-age=300' }, body: readFileSync(join(outDir, 'manifest.json')) }), 'upload manifest')
  console.log('published manifest.json')
}

async function seedItems() {
  if (!flag('apply')) die('refusing to seed without --apply')
  const { url, headers } = remote()
  const rows = []
  const add = (pack, cats, itemsKey) => {
    for (const c of cats) {
      for (const it of c[itemsKey]) {
        rows.push({
          id: `${pack}:${it.id}`,
          pack_key: pack,
          category: c.id,
          payload: it,
          source: STARTER_CREDITS[0].source,
          licence: STARTER_CREDITS[0].licence,
          attribution: STARTER_CREDITS[0].attribution,
          review_status: 'approved',
          reviewed_by: 'MagTile project',
          reviewed_at: new Date().toISOString(),
        })
      }
    }
  }
  add('trivia', TRIVIA_CATEGORIES, 'questions')
  add('words', WORD_CATEGORIES, 'cards')
  add('charades', CHARADE_CATEGORIES, 'cards')
  await must(await fetch(`${url}/rest/v1/content_items?on_conflict=id`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) }), 'seed content_items')
  console.log(`seeded ${rows.length} approved starter items`)
}

const command = process.argv[2]
const out = arg('out')
if (command === 'build') {
  if (!out) die('--out <dir> is required')
  await build(out, Number(arg('version', '2')), arg('input'))
} else if (command === 'export-starters') {
  if (!out) die('--out <dir> is required')
  mkdirSync(out, { recursive: true })
  for (const [key, src] of Object.entries(starterSources())) writeFileSync(join(out, `${key}.json`), JSON.stringify(src, null, 2))
  console.log(`wrote starter sources to ${resolve(out)}`)
} else if (command === 'publish') {
  if (!out) die('--out <dir> is required')
  await publish(out)
} else if (command === 'seed-items') {
  await seedItems()
} else {
  die('usage: publish.mjs build|export-starters|publish|seed-items (see the header of this file)')
}
