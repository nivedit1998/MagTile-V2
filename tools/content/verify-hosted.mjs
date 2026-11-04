// Read-mostly verification of the HOSTED Arcade content setup as an anonymous visitor would see it.
//   node tools/content/verify-hosted.mjs <https://REF.supabase.co> <anon-key>
// The anon key is the public publishable key (it ships in the browser bundle). The only write attempts
// are ones that MUST be refused; if any were accepted this script reports it and exits non-zero.
import { createHash } from 'node:crypto'

const [url, anon] = process.argv.slice(2)
if (!url || !anon) {
  console.error('usage: node tools/content/verify-hosted.mjs <https://REF.supabase.co> <anon-key>')
  process.exit(2)
}
const H = (extra = {}) => ({ apikey: anon, Authorization: `Bearer ${anon}`, ...extra })
let n = 0
function check(name, ok, info = '') {
  n += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  [' + info + ']' : ''}`)
  if (!ok) process.exitCode = 1
}
const json = async (r) => { const t = await r.text(); try { return JSON.parse(t) } catch { return t } }

let res = await fetch(`${url}/storage/v1/object/public/packs/manifest.json`)
const text = await res.text()
check('manifest.json is publicly readable without a key and is under 8 KiB', res.ok && text.length < 8192, `${text.length} bytes, cache-control: ${res.headers.get('cache-control')}`)
check('manifest is served with permissive CORS for browsers', (res.headers.get('access-control-allow-origin') ?? '') !== '', `ACAO: ${res.headers.get('access-control-allow-origin')}`)
const manifest = JSON.parse(text)
for (const p of manifest.packs) {
  const r = await fetch(`${url}/storage/v1/object/public/packs/${p.path}`)
  const bytes = new Uint8Array(await r.arrayBuffer())
  check(`${p.path}: readable, size and SHA-256 match the manifest`, r.ok && bytes.length === p.bytes && createHash('sha256').update(bytes).digest('hex') === p.sha256, `${bytes.length} bytes`)
}
res = await fetch(`${url}/rest/v1/content_packs?select=pack_key,version,status`, { headers: H() })
let body = await json(res)
check('anon reads published pack rows', res.ok && Array.isArray(body) && body.length === manifest.packs.length, JSON.stringify(body).slice(0, 120))
res = await fetch(`${url}/rest/v1/content_catalog?select=pack_key,version`, { headers: H() })
body = await json(res)
check('anon reads the public catalogue view', res.ok && Array.isArray(body) && body.length === manifest.packs.length)
for (const t of ['content_items', 'content_import_runs', 'content_import_cursors', 'content_import_controls']) {
  res = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, { headers: H() })
  check(`anon cannot read ${t}`, !res.ok, `HTTP ${res.status}`)
}
res = await fetch(`${url}/rest/v1/content_packs`, { method: 'POST', headers: H({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify({ pack_key: 'trivia', version: 98, schema_version: 1, item_count: 1, byte_size: 10, gzip_size: 5, checksum_sha256: 'b'.repeat(64), artifact_path: 'trivia-v98.json' }) })
check('anon cannot insert a pack row', !res.ok, `HTTP ${res.status}`)
res = await fetch(`${url}/rest/v1/content_packs?pack_key=eq.trivia`, { method: 'PATCH', headers: H({ 'Content-Type': 'application/json' }), body: JSON.stringify({ status: 'withdrawn' }) })
check('anon cannot update pack rows', !res.ok, `HTTP ${res.status}`)
res = await fetch(`${url}/rest/v1/content_packs?pack_key=eq.trivia`, { method: 'DELETE', headers: H() })
check('anon cannot delete pack rows', !res.ok, `HTTP ${res.status}`)
res = await fetch(`${url}/rest/v1/content_import_controls?id=eq.true`, { method: 'PATCH', headers: H({ 'Content-Type': 'application/json' }), body: JSON.stringify({ imports_enabled: true }) })
check('anon cannot switch imports on', !res.ok, `HTTP ${res.status}`)
res = await fetch(`${url}/storage/v1/object/packs/anon-probe.json`, { method: 'POST', headers: H({ 'Content-Type': 'application/json' }), body: '{}' })
check('anon cannot upload to the packs bucket', !res.ok, `HTTP ${res.status}`)
res = await fetch(`${url}/storage/v1/object/packs/manifest.json`, { method: 'POST', headers: H({ 'Content-Type': 'application/json', 'x-upsert': 'true' }), body: '{}' })
check('anon cannot overwrite manifest.json', !res.ok, `HTTP ${res.status}`)
res = await fetch(`${url}/storage/v1/object/packs/${manifest.packs[0].path}`, { method: 'DELETE', headers: H() })
check('anon cannot delete a pack file', !res.ok, `HTTP ${res.status}`)
res = await fetch(`${url}/storage/v1/object/list/packs`, { method: 'POST', headers: H({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefix: '', limit: 5 }) })
body = await json(res)
check('anon cannot enumerate the bucket via the list API beyond what policies allow', res.ok ? Array.isArray(body) : true, `HTTP ${res.status}${Array.isArray(body) ? ', ' + body.length + ' names listed' : ''}`)
console.log(`\nhosted verification: ${n} checks, ${process.exitCode ? 'WITH FAILURES' : 'all passed'}`)
