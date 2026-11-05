#!/usr/bin/env node
// MagTile Discover ingest (server side, runs on a schedule in GitHub Actions; never in the app).
//
//   node tools/discover/ingest.mjs --out discover.json        dry run: fetch everything, write a local file
//   node tools/discover/ingest.mjs --apply                    fetch everything and publish to Supabase Storage
//
// Publishing needs (read from the environment, never printed or written to files):
//   SUPABASE_URL                 https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    server secret
// Optional:
//   API_NINJAS_KEY               riddles (without it the riddle section is simply left unchanged)
//
// One small JSON file (discover.json in the public `packs` bucket) holds everything the Discover pages
// show. Each section is refreshed on its own schedule and keeps its last good value if a source fails:
//   news     every run (hourly)    BBC News RSS: headline + short description + time. No links, no article text.
//   facts    once per UK day       Wikipedia "Did you know" (CC BY-SA)
//   history  once per UK day       Wikipedia "On this day" (CC BY-SA)
//   trivia   once per UK day       Open Trivia DB (CC BY-SA 4.0)
//   riddle   once per UK day       API Ninjas (personal, non-commercial use)
//   word     once per UK day       Wiktionary word of the day (CC BY-SA)

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const UA = 'MagTile/1.0 (personal project; https://github.com/nivedit1998/MagTile-V2)'
const SCHEMA = 1
const TIMEOUT = 15_000

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const flag = (name) => process.argv.includes(`--${name}`)
const log = (msg) => console.log(msg)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ukDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

async function getText(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(TIMEOUT), redirect: 'follow' })
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`)
  return res.text()
}
const getJson = async (url, headers) => JSON.parse(await getText(url, { Accept: 'application/json', ...headers }))

// ---- text helpers -----------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', pound: '£' }
export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
}
export const stripTags = (s) => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').replace(/\s+([.,;:?!)])/g, '$1').trim()
const clip = (s, max) => {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '))
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:\s]+$/, '')}…`
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

// ---- news (BBC RSS) ---------------------------------------------------------------------------

const BBC = {
  top: 'https://feeds.bbci.co.uk/news/rss.xml',
  uk: 'https://feeds.bbci.co.uk/news/uk/rss.xml',
  world: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  business: 'https://feeds.bbci.co.uk/news/business/rss.xml',
  tech: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
  science: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
}
const NEWS_SECTIONS = [
  { id: 'top', name: 'Top stories', feeds: ['top'] },
  { id: 'uk', name: 'UK', feeds: ['uk'] },
  { id: 'world', name: 'World', feeds: ['world'] },
  { id: 'business', name: 'Business', feeds: ['business'] },
  { id: 'tech', name: 'Tech', feeds: ['tech'] },
  { id: 'ai', name: 'AI', feeds: ['tech', 'business', 'top', 'science'], match: /\b(AI|A\.I\.|artificial intelligence|chatbots?|OpenAI|ChatGPT|Anthropic|Nvidia|Gemini|Copilot|machine learning|robots?|robotics|deepfakes?|large language model)\b/ },
  { id: 'smart', name: 'Smart home', feeds: ['tech', 'business', 'top', 'uk'], match: /\b(smart home|smart homes|smart speakers?|smart meters?|smart devices?|smart lock|smart lights?|Alexa|Hive|Nest|thermostats?|connected home|Internet of Things|IoT|home automation|Matter standard|wi-?fi)\b/i },
]
const SECTION_LIMIT = 10

export function parseRss(xml) {
  const items = []
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1]
    const field = (tag) => {
      const f = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
      if (!f) return ''
      return stripTags(f[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
    }
    const headline = field('title')
    if (!headline) continue
    const when = new Date(field('pubDate'))
    items.push({ h: headline, s: clip(field('description'), 220), t: Number.isNaN(when.getTime()) ? null : when.toISOString() })
  }
  return items
}

async function fetchNews(previous) {
  const feeds = {}
  for (const [key, url] of Object.entries(BBC)) {
    try {
      feeds[key] = parseRss(await getText(url))
    } catch (e) {
      log(`  news: ${key} failed (${e.message})`)
    }
  }
  if (Object.keys(feeds).length === 0) throw new Error('no BBC feed could be read')
  const prevById = new Map((previous?.sections ?? []).map((s) => [s.id, s]))
  const sections = []
  for (const sec of NEWS_SECTIONS) {
    const seen = new Set()
    const items = []
    for (const feedKey of sec.feeds) {
      for (const it of feeds[feedKey] ?? []) {
        if (seen.has(it.h)) continue
        if (sec.match && !sec.match.test(`${it.h} ${it.s}`)) continue
        seen.add(it.h)
        items.push(it)
      }
    }
    items.sort((a, b) => (b.t ?? '').localeCompare(a.t ?? ''))
    const chosen = items.slice(0, SECTION_LIMIT)
    // A filtered section (AI, Smart home) can be empty for a while: keep the pages, say so on screen.
    sections.push({ id: sec.id, name: sec.name, items: chosen.length || !prevById.get(sec.id) ? chosen : [] })
  }
  return { fetchedAt: new Date().toISOString(), source: 'BBC News', sections }
}

// ---- facts (Wikipedia "Did you know") ---------------------------------------------------------

export function parseDyk(wikitext) {
  const hooks = []
  for (const line of wikitext.split('\n')) {
    const m = line.match(/^\*\s*\.\.\.\s*that\s+(.*)$/i)
    if (!m) continue
    let raw = m[1]
    // The bold link is the article the hook is about: '''[[Title|shown]]''' or '''[[Title]]'''.
    const bold = raw.match(/'''\s*\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/)
    const title = bold ? bold[1].trim() : (raw.match(/\[\[([^\]|#]+)/)?.[1] ?? '').trim()
    let text = raw
      .replace(/\{\{[^}]*\}\}/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<ref[\s\S]*?(<\/ref>|\/>)/g, '')
      .replace(/''\(pictured\)''|''\(pictured[^)]*\)''|\(pictured\)/gi, '')
      .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
      .replace(/'''|''/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.;?])/g, '$1')
      .trim()
    text = decodeEntities(text).replace(/\?$/, '.')
    if (!title || text.length < 20) continue
    hooks.push({ title, text: cap(text) })
  }
  return hooks
}

async function fetchFacts(day) {
  const wiki = await getJson('https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&page=Template:Did_you_know&formatversion=2')
  const hooks = parseDyk(wiki.parse.wikitext).slice(0, 8)
  if (hooks.length === 0) throw new Error('no "Did you know" hooks found')
  const items = []
  for (const hook of hooks) {
    let explain = ''
    let category = ''
    try {
      const s = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hook.title.replace(/ /g, '_'))}`)
      explain = clip(stripTags(s.extract ?? ''), 260)
      category = cap(stripTags(s.description ?? ''))
    } catch {
      /* the fact itself is still good without the extra context */
    }
    items.push({ title: hook.title, fact: hook.text, about: explain, category: category || null })
  }
  return { day, fetchedAt: new Date().toISOString(), source: 'Wikipedia (Did you know)', items }
}

// ---- history (Wikipedia "On this day") --------------------------------------------------------

async function fetchHistory(day) {
  const [, mm, dd] = day.split('-')
  const data = await getJson(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`)
  const events = (data.events ?? [])
    .filter((e) => Number.isInteger(e.year) && typeof e.text === 'string' && e.text.length > 20)
    .map((e) => ({ year: e.year, text: clip(stripTags(e.text), 240) }))
    .sort((a, b) => a.year - b.year)
  if (events.length === 0) throw new Error('no events returned')
  // Keep a readable spread across the centuries rather than the first twelve.
  const keep = 12
  const items = events.length <= keep ? events : Array.from({ length: keep }, (_, i) => events[Math.round((i * (events.length - 1)) / (keep - 1))])
  return { day, date: `${mm}-${dd}`, fetchedAt: new Date().toISOString(), source: 'Wikipedia (On this day)', items }
}

// ---- trivia (Open Trivia DB) ------------------------------------------------------------------

async function fetchTrivia(day) {
  let data = null
  for (let attempt = 0; attempt < 3; attempt++) {
    data = await getJson('https://opentdb.com/api.php?amount=1&type=multiple&encode=url3986')
    if (data.response_code === 0 && data.results?.length) break
    await sleep(6000) // OpenTDB allows one request per five seconds
  }
  if (!data || data.response_code !== 0 || !data.results?.length) throw new Error('Open Trivia DB returned no question')
  const q = data.results[0]
  const dec = (s) => decodeURIComponent(s)
  const correct = dec(q.correct_answer)
  const options = [...q.incorrect_answers.map(dec), correct]
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[options[i], options[j]] = [options[j], options[i]]
  }
  return {
    day,
    fetchedAt: new Date().toISOString(),
    source: 'Open Trivia DB (CC BY-SA 4.0)',
    category: dec(q.category).replace(/^Entertainment: |^Science: /, ''),
    difficulty: q.difficulty,
    question: dec(q.question),
    options,
    answer: options.indexOf(correct),
  }
}

// ---- riddle (API Ninjas) ----------------------------------------------------------------------

async function fetchRiddle(day) {
  const key = process.env.API_NINJAS_KEY
  if (!key) throw new Error('API_NINJAS_KEY is not set')
  const data = await getJson('https://api.api-ninjas.com/v1/riddles', { 'X-Api-Key': key })
  const r = Array.isArray(data) ? data[0] : null
  if (!r || typeof r.question !== 'string' || typeof r.answer !== 'string') throw new Error('API Ninjas returned no riddle')
  const title = typeof r.title === 'string' ? r.title.trim() : ''
  return { day, fetchedAt: new Date().toISOString(), source: 'API Ninjas', title: title || null, question: cap(r.question.trim()), answer: cap(r.answer.trim()) }
}

// ---- word of the day (Wiktionary) -------------------------------------------------------------

const POS = { n: 'Noun', v: 'Verb', adj: 'Adjective', adv: 'Adverb', prep: 'Preposition', conj: 'Conjunction', interj: 'Interjection', pron: 'Pronoun', phrase: 'Phrase', prov: 'Proverb' }

export function parseWotd(wikitext) {
  const m = wikitext.match(/\{\{WOTD\|([^|}]+)\|([^|}]*)/)
  return m ? { word: m[1].trim(), pos: m[2].trim() } : null
}

async function fetchWord(day) {
  const [y, mm, dd] = day.split('-').map(Number)
  const month = new Date(Date.UTC(2000, mm - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })
  const page = encodeURIComponent(`Wiktionary:Word_of_the_day/${y}/${month}_${dd}`)
  const wp = await getJson(`https://en.wiktionary.org/w/api.php?action=parse&format=json&prop=wikitext&page=${page}&formatversion=2`)
  const wotd = parseWotd(wp.parse?.wikitext ?? '')
  if (!wotd) throw new Error('could not read the Wiktionary word of the day')
  const defs = await getJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(wotd.word)}`)
  const entries = defs.en ?? []
  const wanted = (POS[wotd.pos] ?? wotd.pos).toLowerCase()
  const entry = entries.find((e) => e.partOfSpeech?.toLowerCase() === wanted) ?? entries[0]
  if (!entry) throw new Error(`no English definition for "${wotd.word}"`)
  const defn = (entry.definitions ?? []).find((d) => stripTags(d.definition ?? '').length > 8)
  if (!defn) throw new Error(`no usable definition for "${wotd.word}"`)
  const example = (defn.parsedExamples?.[0]?.example ?? defn.examples?.[0] ?? '')
  return {
    day,
    fetchedAt: new Date().toISOString(),
    source: 'Wiktionary (CC BY-SA)',
    word: wotd.word,
    partOfSpeech: entry.partOfSpeech ?? null,
    definition: clip(stripTags(defn.definition), 260),
    example: example ? clip(stripTags(example), 200) : null,
  }
}

// ---- orchestration ----------------------------------------------------------------------------

async function loadPrevious(supabaseUrl) {
  const local = arg('previous')
  try {
    const text = local ? readFileSync(local, 'utf8') : supabaseUrl ? await getText(`${supabaseUrl}/storage/v1/object/public/packs/discover.json?ts=${Date.now()}`, { 'Cache-Control': 'no-cache' }) : null
    if (!text) return null
    const parsed = JSON.parse(text)
    return parsed && parsed.schema === SCHEMA ? parsed : null
  } catch {
    return null
  }
}

async function main() {
  const supabaseUrl = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
  const apply = flag('apply')
  const out = arg('out')
  if (apply && (!supabaseUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY)) throw new Error('--apply needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  if (!apply && !out) throw new Error('pass --out <file> for a dry run, or --apply to publish')

  const day = arg('day') ?? ukDate()
  const previous = await loadPrevious(supabaseUrl)
  const bundle = { schema: SCHEMA, generatedAt: new Date().toISOString(), day, news: previous?.news ?? null, facts: previous?.facts ?? null, history: previous?.history ?? null, trivia: previous?.trivia ?? null, riddle: previous?.riddle ?? null, word: previous?.word ?? null }
  const problems = []

  const run = async (name, fn, isDue) => {
    if (!isDue) {
      log(`${name}: up to date`)
      return
    }
    try {
      bundle[name] = await fn()
      log(`${name}: refreshed`)
    } catch (e) {
      problems.push(`${name}: ${e.message}`)
      log(`${name}: FAILED (${e.message}); keeping ${bundle[name] ? 'the previous value' : 'nothing'}`)
    }
  }
  const dailyDue = (name) => flag('force') || !bundle[name] || bundle[name].day !== day

  await run('news', () => fetchNews(previous?.news), true)
  await run('facts', () => fetchFacts(day), dailyDue('facts'))
  await run('history', () => fetchHistory(day), dailyDue('history'))
  await run('trivia', () => fetchTrivia(day), dailyDue('trivia'))
  await run('riddle', () => fetchRiddle(day), dailyDue('riddle'))
  await run('word', () => fetchWord(day), dailyDue('word'))

  const text = JSON.stringify(bundle)
  if (text.length > 400_000) throw new Error(`bundle is ${text.length} bytes, over the 400000 byte budget`)
  if (out) {
    writeFileSync(out, JSON.stringify(bundle, null, 2))
    log(`wrote ${out} (${text.length} bytes)`)
  }
  if (apply) {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/packs/discover.json`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'x-upsert': 'true',
        'cache-control': 'max-age=300',
      },
      body: text,
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`upload failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    log(`published discover.json (${text.length} bytes)`)
  }
  if (problems.length) {
    console.error(`finished with ${problems.length} source problem(s):\n- ${problems.join('\n- ')}`)
    // Fail the run only if nothing usable exists at all; one flaky source must not hide the others.
    if (!bundle.news && !bundle.facts && !bundle.history && !bundle.trivia && !bundle.riddle && !bundle.word) process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`error: ${e.message}`)
    process.exit(1)
  })
}
