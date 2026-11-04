// Verifies the Phase 6 migration, the Storage bucket and the publish tool against an ISOLATED LOCAL
// Supabase stack (never a hosted project). How to run it (from the repo root):
//   1. Make a scratch workdir with a COPY of supabase/config.toml (change project_id so new, separate
//      Docker volumes are used) plus supabase/migrations/*.sql and an empty supabase/seed.sql.
//   2. npx supabase start --workdir <scratch> -x gotrue,realtime,studio,imgproxy,edge-runtime,logflare,vector,mailpit,postgres-meta
//   3. node tools/content/verify-local.mjs
//   4. npx supabase stop --no-backup --workdir <scratch>
// It mints throw-away JWTs from the public local-demo secret, which only a local stack accepts.
// Local-only verification of the Phase 6 migration against an ISOLATED local Supabase stack.
// Mints throw-away JWTs with the local stack's default demo secret; nothing here touches a hosted project.
import { createHmac } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const API = 'http://127.0.0.1:54321'
const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function jwt(role) {
  const h = b64({ alg: 'HS256', typ: 'JWT' })
  const p = b64({ iss: 'supabase-demo', role, exp: 1983812996 })
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}
const anon = jwt('anon')
const service = jwt('service_role')
const H = (k, extra = {}) => ({ apikey: k, Authorization: `Bearer ${k}`, ...extra })

let n = 0
function check(name, ok, info = '') {
  n += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  [' + info + ']' : ''}`)
  if (!ok) process.exitCode = 1
}
const j = async (res) => { const t = await res.text(); try { return JSON.parse(t) } catch { return t } }

// --- build + publish v2 packs with the real admin tool against the LOCAL stack ----------------
const out = mkdtempSync(join(process.env.TEMP ?? '.', 'packs-'))
const env = { ...process.env, SUPABASE_URL: API, SUPABASE_SERVICE_ROLE_KEY: service }
const run = (...args) => spawnSync(process.execPath, ['tools/content/publish.mjs', ...args], { cwd: process.cwd(), env, encoding: 'utf8' })
let r = run('build', '--out', out, '--version', '2')
check('tool: build (dry run) succeeds and writes nothing remote', r.status === 0, r.stdout.split('\n')[0])
r = run('publish', '--out', out)
check('tool: publish without --apply refuses', r.status !== 0 && /--apply/.test(r.stderr))
r = run('seed-items')
check('tool: seed-items without --apply refuses', r.status !== 0)
r = spawnSync(process.execPath, ['tools/content/publish.mjs', 'publish', '--out', out, '--apply'], { cwd: process.cwd(), env: { ...process.env }, encoding: 'utf8' })
check('tool: --apply without credentials refuses', r.status !== 0 && /must be set/.test(r.stderr))
r = spawnSync(process.execPath, ['tools/content/publish.mjs', 'publish', '--out', out, '--apply'], { cwd: process.cwd(), env: { ...process.env, SUPABASE_URL: 'https://example.com', SUPABASE_SERVICE_ROLE_KEY: 'x' }, encoding: 'utf8' })
check('tool: --apply refuses a non-Supabase URL', r.status !== 0 && /does not look like/.test(r.stderr))

r = run('seed-items', '--apply')
check('tool: seed-items --apply inserts approved starter items (service role)', r.status === 0, r.stdout.trim())
r = run('publish', '--out', out, '--apply')
check('tool: publish --apply uploads packs, registers rows, uploads manifest last', r.status === 0 && /published manifest.json/.test(r.stdout), r.status === 0 ? '' : r.stderr.slice(0, 200))
r = run('publish', '--out', out, '--apply')
check('tool: republishing the same version is refused (packs are immutable)', r.status !== 0, r.stderr.slice(0, 120))

// --- anon (what a device or any stranger can do) ---------------------------------------------
let res = await fetch(`${API}/rest/v1/content_packs?select=pack_key,version,status`, { headers: H(anon) })
let body = await j(res)
check('anon can read published pack rows', res.ok && Array.isArray(body) && body.length === 3, `${body.length} rows`)
res = await fetch(`${API}/rest/v1/content_catalog?select=pack_key,version`, { headers: H(anon) })
body = await j(res)
check('anon can read the public catalogue view (newest published per pack)', res.ok && body.length === 3 && body.every((x) => x.version === 2))
for (const table of ['content_items', 'content_import_runs', 'content_import_cursors', 'content_import_controls']) {
  res = await fetch(`${API}/rest/v1/${table}?select=*`, { headers: H(anon) })
  body = await j(res)
  check(`anon cannot read ${table}`, !res.ok && (res.status === 401 || res.status === 403), `HTTP ${res.status} ${body.code ?? ''}`)
}
res = await fetch(`${API}/rest/v1/content_packs`, { method: 'POST', headers: H(anon, { 'Content-Type': 'application/json' }), body: JSON.stringify({ pack_key: 'trivia', version: 99, schema_version: 1, item_count: 1, byte_size: 1, gzip_size: 1, checksum_sha256: 'a'.repeat(64), artifact_path: 'trivia-v99.json' }) })
check('anon cannot insert a pack row', !res.ok, `HTTP ${res.status}`)
res = await fetch(`${API}/rest/v1/content_packs?pack_key=eq.trivia`, { method: 'PATCH', headers: H(anon, { 'Content-Type': 'application/json' }), body: JSON.stringify({ status: 'withdrawn' }) })
check('anon cannot update a pack row', !res.ok, `HTTP ${res.status}`)
res = await fetch(`${API}/rest/v1/content_packs?pack_key=eq.trivia`, { method: 'DELETE', headers: H(anon) })
check('anon cannot delete a pack row', !res.ok, `HTTP ${res.status}`)

res = await fetch(`${API}/storage/v1/object/public/packs/manifest.json`)
const manifestText = await res.text()
check('anyone can GET manifest.json from the public bucket without a key', res.ok && manifestText.length > 10 && manifestText.length <= 8192, `${manifestText.length} bytes`)
const manifest = JSON.parse(manifestText)
res = await fetch(`${API}/storage/v1/object/public/packs/${manifest.packs[0].path}`)
const packBytes = new Uint8Array(await res.arrayBuffer())
check('anyone can GET a pack and its size matches the manifest', res.ok && packBytes.length === manifest.packs[0].bytes, `${packBytes.length} bytes`)
res = await fetch(`${API}/storage/v1/object/packs/evil.json`, { method: 'POST', headers: H(anon, { 'Content-Type': 'application/json' }), body: '{}' })
check('anon cannot upload to the packs bucket', !res.ok, `HTTP ${res.status}`)
res = await fetch(`${API}/storage/v1/object/packs/manifest.json`, { method: 'POST', headers: H(anon, { 'Content-Type': 'application/json', 'x-upsert': 'true' }), body: '{}' })
check('anon cannot overwrite the manifest', !res.ok, `HTTP ${res.status}`)
res = await fetch(`${API}/storage/v1/object/packs/${manifest.packs[0].path}`, { method: 'DELETE', headers: H(anon) })
check('anon cannot delete a pack file', !res.ok || ((await j(res)).length ?? 0) === 0, `HTTP ${res.status}`)
res = await fetch(`${API}/storage/v1/object/packs/big.json`, { method: 'POST', headers: H(service, { 'Content-Type': 'application/json' }), body: 'x'.repeat(600 * 1024) })
check('even the service role cannot store a file over the 512 KiB bucket limit', !res.ok, `HTTP ${res.status}`)
res = await fetch(`${API}/storage/v1/object/packs/not-json.png`, { method: 'POST', headers: H(service, { 'Content-Type': 'image/png' }), body: 'png' })
check('bucket accepts JSON only (other MIME types refused)', !res.ok, `HTTP ${res.status}`)

// --- immutability and constraints (service role bypasses RLS but not triggers/checks) ----------
res = await fetch(`${API}/rest/v1/content_packs?pack_key=eq.trivia&version=eq.2`, { method: 'PATCH', headers: H(service, { 'Content-Type': 'application/json' }), body: JSON.stringify({ item_count: 5 }) })
check('published pack rows are immutable (column edit rejected)', !res.ok, (await j(res)).message ?? `HTTP ${res.status}`)
res = await fetch(`${API}/rest/v1/content_packs?pack_key=eq.trivia&version=eq.2`, { method: 'DELETE', headers: H(service) })
check('published pack rows cannot be deleted', !res.ok, (await j(res)).message ?? `HTTP ${res.status}`)
res = await fetch(`${API}/rest/v1/content_packs`, { method: 'POST', headers: H(service, { 'Content-Type': 'application/json' }), body: JSON.stringify({ pack_key: 'trivia', version: 1, schema_version: 1, item_count: 1, byte_size: 10, gzip_size: 5, checksum_sha256: 'a'.repeat(64), artifact_path: 'trivia-v1.json' }) })
check('version 1 (the bundled starter) cannot be published', !res.ok, (await j(res)).message ?? `HTTP ${res.status}`)
res = await fetch(`${API}/rest/v1/content_packs`, { method: 'POST', headers: H(service, { 'Content-Type': 'application/json' }), body: JSON.stringify({ pack_key: 'trivia', version: 3, schema_version: 1, item_count: 1, byte_size: 600000, gzip_size: 5, checksum_sha256: 'a'.repeat(64), artifact_path: 'trivia-v3.json' }) })
check('a pack over the 512 KiB budget cannot be registered', !res.ok, (await j(res)).message ?? `HTTP ${res.status}`)
res = await fetch(`${API}/rest/v1/content_packs`, { method: 'POST', headers: H(service, { 'Content-Type': 'application/json' }), body: JSON.stringify({ pack_key: 'trivia', version: 3, schema_version: 1, item_count: 1, byte_size: 100, gzip_size: 50, checksum_sha256: 'nothex', artifact_path: 'trivia-v3.json' }) })
check('a malformed checksum is rejected', !res.ok)
res = await fetch(`${API}/rest/v1/content_items`, { method: 'POST', headers: H(service, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify({ id: 'trivia:test:0', pack_key: 'trivia', category: 'test', payload: { q: 'x' }, source: '', licence: '', review_status: 'approved' }) })
check('an item cannot be approved without provenance and review time', !res.ok, (await j(res)).message ?? `HTTP ${res.status}`)
res = await fetch(`${API}/rest/v1/content_items?select=id,review_status&review_status=eq.approved&limit=1000`, { headers: H(service) })
body = await j(res)
check('service role sees the seeded approved starter items', res.ok && body.length === 60 + 180 + 114, `${body.length} items`)
res = await fetch(`${API}/rest/v1/content_import_controls?select=imports_enabled`, { headers: H(service) })
body = await j(res)
check('imports are OFF by default (fail closed)', res.ok && body.length === 1 && body[0].imports_enabled === false)
res = await fetch(`${API}/rest/v1/content_import_controls?id=eq.true`, { method: 'PATCH', headers: H(anon, { 'Content-Type': 'application/json' }), body: JSON.stringify({ imports_enabled: true }) })
check('anon cannot switch imports on', !res.ok, `HTTP ${res.status}`)

// --- withdrawal ----------------------------------------------------------------------------
res = await fetch(`${API}/rest/v1/content_packs?pack_key=eq.charades&version=eq.2`, { method: 'PATCH', headers: H(service, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify({ status: 'withdrawn' }) })
check('a pack can be withdrawn (status only)', res.ok, `HTTP ${res.status}`)
res = await fetch(`${API}/rest/v1/content_packs?select=pack_key&pack_key=eq.charades`, { headers: H(anon) })
body = await j(res)
check('a withdrawn pack disappears for anon', res.ok && body.length === 0)
res = await fetch(`${API}/rest/v1/content_catalog?select=pack_key`, { headers: H(anon) })
body = await j(res)
check('and from the public catalogue', res.ok && body.length === 2 && !body.some((x) => x.pack_key === 'charades'))
res = await fetch(`${API}/rest/v1/content_packs?pack_key=eq.charades&version=eq.2`, { method: 'PATCH', headers: H(service, { 'Content-Type': 'application/json' }), body: JSON.stringify({ status: 'published' }) })
check('a withdrawn pack cannot be re-published', !res.ok, (await j(res)).message ?? `HTTP ${res.status}`)

console.log(`\nlocal rls-test: ${n} checks, ${process.exitCode ? 'WITH FAILURES' : 'all passed'}`)
