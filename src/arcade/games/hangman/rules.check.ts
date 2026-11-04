// Focused deterministic checks for Hangman rules and the bundled banks.
// Run:  node src/arcade/games/hangman/rules.check.ts   (non-zero exit on failure)
import { CHARADE_CATEGORIES, WORD_CATEGORIES, buildPool, validateBank } from '../../content/banks.ts'
import type { Random } from '../../shared/deck.ts'
import {
  didGuesserWin, guess, isSolved, letterSet, mistakes, newMatch, nextRound, normalizeWord, parseSettings, parseState, setWord,
  tiles, validateNames, wrongLetters, type Settings, type State,
} from './rules.ts'

let checks = 0
function check(name: string, ok: boolean): void {
  checks += 1
  if (!ok) throw new Error(`FAILED: ${name}`)
}
function seeded(seed: number): Random {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const must = <T>(r: { ok: true; state: T } | { ok: false; reason: string }): T => {
  if (!r.ok) throw new Error(`unexpected reject ${r.reason}`)
  return r.state
}

// 1. Bundled banks are structurally valid; every word-bank entry is playable in Hangman.
check('word banks valid', validateBank(WORD_CATEGORIES).length === 0)
check('charade banks valid', validateBank(CHARADE_CATEGORIES).length === 0)
check('every word-bank word normalises to itself upper-cased', WORD_CATEGORIES.every((c) => c.cards.every((card) => { const n = normalizeWord(card.text); return n.ok && n.word === card.text.toUpperCase() })))
check('all categories have at least 10 cards', [...WORD_CATEGORIES, ...CHARADE_CATEGORIES].every((c) => c.cards.length >= 10))
check('Hollywood and Bollywood titles carry year and language', ['hollywood', 'bollywood', 'shows'].every((id) => CHARADE_CATEGORIES.find((c) => c.id === id)!.cards.every((card) => /^\d{4} · \w+$/.test(card.meta ?? ''))))
check('pool follows bank order and selection', buildPool(WORD_CATEGORIES, ['food', 'animals']).length === 60 && buildPool(WORD_CATEGORIES, ['food'])[0].id === 'food:0' && buildPool(WORD_CATEGORIES, []).length === 0)

// 2. Word normalisation.
{
  const ok = (s: string) => { const r = normalizeWord(s); return r.ok ? r.word : null }
  check('upper-cases and folds diacritics', ok('café') === 'CAFE' && ok('Crème brûlée') === 'CREME BRULEE')
  check('keeps allowed punctuation, collapses spaces', ok("  rock   'n' roll ") === "ROCK 'N' ROLL" && ok('well-known') === 'WELL-KNOWN' && ok('Dr. Who') === 'DR. WHO')
  check('curly apostrophes become straight', ok('don’t stop') === "DON'T STOP")
  check('rejects digits, symbols, empty, long, one-letter', ['', '   ', 'abc1', 'a@b', 'a'.repeat(25), 'aaaa', 'a-a', '😀😀'].every((x) => ok(x) === null))
  check('letterSet ignores punctuation', letterSet("DON'T STOP").sort().join('') === 'DNOPST')
}

// 3. Setup validation.
check('names validate like other games', validateNames('Ann', 'Bob').ok && !validateNames('', 'Bob').ok && !validateNames('Ann', 'ann').ok && !validateNames('A'.repeat(15), 'B').ok)
const cats = WORD_CATEGORIES.map((c) => c.id)
const customSettings: Settings = { names: ['Ann', 'Bob'], mode: 'custom', limit: 6, categoryIds: [] }
const randomSettings: Settings = { names: ['Ann', 'Bob'], mode: 'random', limit: 6, categoryIds: ['animals'] }
check('settings parse', parseSettings(JSON.parse(JSON.stringify(customSettings)), cats) !== null && parseSettings(JSON.parse(JSON.stringify(randomSettings)), cats) !== null)
check('settings reject bad input', [
  { ...customSettings, limit: 7 }, { ...customSettings, categoryIds: ['animals'] }, { ...randomSettings, categoryIds: [] },
  { ...randomSettings, categoryIds: ['nope'] }, { ...randomSettings, mode: 'x' }, { ...customSettings, names: ['Ann', 'ann'] }, null,
].every((x) => parseSettings(x, cats) === null))

// 4. Custom-word flow: word is hidden until entered, then play.
let c: State = newMatch(customSettings, [], seeded(1))
check('custom match starts awaiting the setter word, Ann guesses', c.phase === 'word' && c.word === null && c.guesser === 0)
check('cannot guess before a word is set', !guess(c, customSettings, 'A').ok)
check('setWord rejects an invalid word and keeps awaiting', (() => { const r = setWord(c, 'ab1'); return !r.ok })())
c = must(setWord(c, 'Banana'))
check('play begins with the folded word', c.phase === 'play' && c.word === 'BANANA' && c.guessed.length === 0)
check('cannot set a word twice', !setWord(c, 'Other').ok)

// Guessing: case-insensitive, duplicates ignored, mistakes counted.
c = must(guess(c, customSettings, 'b'))
check('correct guess reveals', tiles(c).filter((t) => t.shown).map((t) => t.ch).join('') === 'B' && mistakes(c) === 0)
check('duplicate guess is ignored (rejected, no mistake)', (() => { const r = guess(c, customSettings, 'B'); return !r.ok && r.reason === 'duplicate' && mistakes(c) === 0 })())
check('non-letters rejected', ['1', '?', '', 'AB', ' '].every((x) => !guess(c, customSettings, x).ok))
c = must(guess(c, customSettings, 'z'))
check('wrong guess counts a mistake', mistakes(c) === 1 && wrongLetters(c).join('') === 'Z')
check('guess does not mutate its input', (() => { const b = JSON.stringify(c); guess(c, customSettings, 'Q'); return JSON.stringify(c) === b })())

// Win: guesser scores, roles swap next round.
let w = c
for (const l of 'AN') w = must(guess(w, customSettings, l))
check('solving ends the round and scores the guesser', w.phase === 'result' && isSolved(w) && didGuesserWin(w) && w.scores[0] === 1 && w.scores[1] === 0)
check('no guessing after the round ends', !guess(w, customSettings, 'Q').ok)
{
  const n = must(nextRound(w, customSettings, [], seeded(2)))
  check('next round swaps roles and awaits a new word', n.round === 2 && n.guesser === 1 && n.phase === 'word' && n.word === null && n.guessed.length === 0 && n.scores[0] === 1)
  check('cannot skip an unfinished round', !nextRound(c, customSettings, [], seeded(2)).ok)
}
// Loss: setter scores in custom mode; limit is fixed.
{
  let l = must(setWord(newMatch(customSettings, [], seeded(1)), 'Zebra'))
  for (const x of 'QWXVKJ') l = must(guess(l, customSettings, x)) // 6 wrong
  check('reaching the limit ends the round as a loss, setter scores', l.phase === 'result' && !didGuesserWin(l) && l.scores[0] === 0 && l.scores[1] === 1)
  check('word is revealed in the result tiles', tiles(l, true).every((t) => t.shown) && tiles(l, false).some((t) => t.letter && !t.shown))
  const five: Settings = { ...customSettings, limit: 5 }
  let f = must(setWord(newMatch(five, [], seeded(1)), 'Zebra'))
  for (const x of 'QWXV') f = must(guess(f, five, x))
  check('limit is configurable (5th wrong guess ends it)', f.phase === 'play' && must(guess(f, five, 'K')).phase === 'result')
}
check('prefilled spaces and punctuation', (() => {
  const s = must(setWord(newMatch(customSettings, [], seeded(1)), "rock 'n' roll"))
  return tiles(s).filter((t) => !t.letter).every((t) => t.shown) && tiles(s).filter((t) => t.letter).every((t) => !t.shown)
})())
check('phrase solved by letters alone (punctuation needs no guess)', (() => {
  let s = must(setWord(newMatch(customSettings, [], seeded(1)), 'Dr. No'))
  for (const l of 'DRNO') s = must(guess(s, customSettings, l))
  return s.phase === 'result' && didGuesserWin(s)
})())

// 5. Random mode: deck over the pool, no repeat until exhausted, loss gives no setter point.
{
  const pool = buildPool(WORD_CATEGORIES, ['animals']).map((x) => x.text.toUpperCase())
  let r: State = newMatch(randomSettings, pool, seeded(8))
  check('random match starts in play with a pool word', r.phase === 'play' && r.word !== null && pool.includes(r.word) && r.deck !== null)
  const seen = [r.word!]
  for (let i = 0; i < pool.length - 1; i++) {
    for (const l of letterSet(r.word!)) r = must(guess(r, randomSettings, l))
    r = must(nextRound(r, randomSettings, pool, seeded(50 + i)))
    seen.push(r.word!)
  }
  check('a full deck of words has no repeats', new Set(seen).size === pool.length)
  let lost: State = newMatch(randomSettings, pool, seeded(8))
  const wrong = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter((l) => !lost.word!.includes(l)).slice(0, 6)
  for (const l of wrong) lost = must(guess(lost, randomSettings, l))
  check('loss in random mode scores nobody', lost.phase === 'result' && lost.scores[0] === 0 && lost.scores[1] === 0)
  check('random roles alternate too', must(nextRound(lost, randomSettings, pool, seeded(1))).guesser === 1)
}

// 6. Save validation.
{
  const word = must(setWord(newMatch(customSettings, [], seeded(1)), 'Banana'))
  const mid = must(guess(must(guess(word, customSettings, 'B')), customSettings, 'Z'))
  const rt = (x: State, s: Settings, pool: string[] = []) => parseState(JSON.parse(JSON.stringify(x)), s, pool)
  check('custom states roundtrip (awaiting word, mid-play, result)', rt(newMatch(customSettings, [], seeded(1)), customSettings) !== null && JSON.stringify(rt(mid, customSettings)) === JSON.stringify(mid) && rt(w, customSettings) !== null)
  const pool = buildPool(WORD_CATEGORIES, ['animals']).map((x) => x.text.toUpperCase())
  const rnd = newMatch(randomSettings, pool, seeded(3))
  check('random state roundtrips', JSON.stringify(rt(rnd, randomSettings, pool)) === JSON.stringify(rnd))
  const bad = (mut: (o: Record<string, unknown>) => void, s: Settings = customSettings, src: State = mid, p: string[] = []) => {
    const o = JSON.parse(JSON.stringify(src)) as Record<string, unknown>
    mut(o)
    return parseState(o, s, p) === null
  }
  check('rejects duplicate / non-letter guesses', bad((o) => { o.guessed = ['B', 'B'] }) && bad((o) => { o.guessed = ['b'] }) && bad((o) => { o.guessed = ['1'] }))
  check('rejects play state that is already solved or lost', bad((o) => { o.guessed = ['B', 'A', 'N'] }) && bad((o) => { o.guessed = ['Q', 'W', 'X', 'V', 'K', 'J'] }))
  check('rejects result without a decided word', bad((o) => { o.phase = 'result' }))
  check('rejects result with extra guesses after the end', bad((o) => { (o.guessed as string[]).push('Q') }, customSettings, w))
  check('rejects wrong guesser for the round', bad((o) => { o.guesser = 1 }))
  check('rejects score drift in custom mode', bad((o) => { o.scores = [3, 0] }))
  check('rejects an unnormalised or illegal word', bad((o) => { o.word = 'banana' }) && bad((o) => { o.word = 'B4NANA' }))
  check('rejects a word-phase state that already holds a word', bad((o) => { o.phase = 'word' }))
  check('rejects a random-mode word outside the pool', bad((o) => { o.word = 'NOTINPOOL' }, randomSettings, rnd, pool))
  check('rejects a corrupt deck', bad((o) => { (o.deck as { order: number[] }).order[0] = (o.deck as { order: number[] }).order[1] }, randomSettings, rnd, pool))
  check('rejects random state with the wrong pool size', parseState(JSON.parse(JSON.stringify(rnd)), randomSettings, pool.slice(0, 12)) === null)
  check('rejects junk', parseState(null, customSettings, []) === null && parseState('x', customSettings, []) === null && parseState([], customSettings, []) === null)
}

console.log(`hangman rules.check: ${checks} checks passed`)
