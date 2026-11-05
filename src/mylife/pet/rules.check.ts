// Deterministic checks for the Virtual Pet rules and sprites.
// Run (no test framework, no packages):  node src/mylife/pet/rules.check.ts
import {
  ADULT_AT_DAY, CHILD_AT_DAY, HATCH_MS, MAX_CATCH_UP_H, NAMES, ageDays, applyActivity, chooseName, daysBetween, feed, isNight, learnWord,
  minutesToHatch, mood, newPet, parsePet, play, rest, shiftDay, streak, thought, tick, ukDay,
  type Activity, type Pet,
} from './rules.ts'
import { GRID, sprite } from './sprites.ts'

let checks = 0
function check(name: string, ok: boolean): void {
  checks += 1
  if (!ok) throw new Error(`FAILED: ${name}`)
}

const H = 3_600_000
// 10:00 UK on 2026-03-02 (GMT, no daylight saving), so UK clock time equals UTC.
const T0 = Date.UTC(2026, 2, 2, 10, 0, 0)
const none: Activity = { arcadeDay: null, discoverDay: null, visits: [] }

// 1. UK time helpers across the clock change (BST starts 2026-03-29).
check('UK day in winter', ukDay(Date.UTC(2026, 0, 15, 23, 30)) === '2026-01-15')
check('UK day in summer rolls over an hour early', ukDay(Date.UTC(2026, 5, 15, 23, 30)) === '2026-06-16')
check('night at 23:00 UK', isNight(Date.UTC(2026, 0, 15, 23, 0)))
check('night at 06:59 UK', isNight(Date.UTC(2026, 0, 15, 6, 59)))
check('day at 07:00 UK', !isNight(Date.UTC(2026, 0, 15, 7, 0)))
check('day at 21:59 UK', !isNight(Date.UTC(2026, 0, 15, 21, 59)))
check('daysBetween', daysBetween('2026-02-28', '2026-03-02') === 2 && shiftDay('2026-03-01', -1) === '2026-02-28')

// 2. An egg hatches after exactly one hour and only then.
const egg = newPet(T0)
check('new pet is an egg', egg.stage === 'egg' && egg.name === null && egg.hatchedAt === null)
check('minutes to hatch', minutesToHatch(egg, T0) === 60 && minutesToHatch(egg, T0 + 30 * 60_000) === 30)
check('not hatched at 59 min', tick(egg, T0 + HATCH_MS - 60_000).stage === 'egg')
const baby = tick(egg, T0 + HATCH_MS)
check('hatches at 60 min', baby.stage === 'baby' && baby.hatchedAt === T0 + HATCH_MS && baby.food === 80 && baby.joy === 80 && baby.energy === 100)
check('egg refuses care', !feed(egg, T0).ok && !play(egg, T0).ok && !rest(egg, T0).ok)
check('egg cannot be named', chooseName(egg, 'Pip').name === null)

// 3. Naming only accepts the offered names, once.
const named = chooseName(baby, 'Mochi')
check('names a hatched pet', named.name === 'Mochi')
check('rejects a name that was not offered', chooseName(baby, 'Rex').name === null)
check('name is final', chooseName(named, 'Pip').name === 'Mochi')

// 4. Needs drift: awake rates by day, sleep rates at night, never below 0 or above 100.
const dayPet: Pet = { ...named, hatchedAt: T0, lastTick: T0, stage: 'baby', food: 80, joy: 80, energy: 100, smarts: 20 }
const d4 = tick(dayPet, T0 + 4 * H) // 10:00 to 14:00
check('4 awake hours: food 80 -> 64', Math.round(d4.food) === 64)
check('4 awake hours: joy 80 -> 68', Math.round(d4.joy) === 68)
check('4 awake hours: energy 100 -> 92', Math.round(d4.energy) === 92)
check('4 awake hours: smarts 20 -> 18', Math.round(d4.smarts) === 18)
const night = Date.UTC(2026, 2, 2, 22, 0, 0)
const sleepy: Pet = { ...dayPet, lastTick: night, energy: 20, food: 50, joy: 50 }
const slept = tick(sleepy, night + 8 * H) // 22:00 to 06:00
check('8 sleeping hours: energy 20 -> 100', slept.energy === 100)
check('8 sleeping hours: food 50 -> 42', Math.round(slept.food) === 42)
check('8 sleeping hours: joy 50 -> 46', Math.round(slept.joy) === 46)
const floor = tick({ ...dayPet, food: 5, joy: 5, energy: 5, smarts: 1 }, T0 + 10 * H)
check('stats floor at zero, pet survives', floor.food === 0 && floor.joy === 0 && floor.energy === 0 && floor.smarts === 0 && floor.stage === 'baby')
check('time going backwards changes nothing but the clock', tick(d4, T0).food === d4.food && tick(d4, T0).lastTick === T0)

// 5. A long absence is simulated for at most 48 h (everything has floored at zero by then anyway).
const week = tick({ ...dayPet, food: 100, joy: 100, energy: 100 }, T0 + 7 * 24 * H)
const capped = tick({ ...dayPet, food: 100, joy: 100, energy: 100, lastTick: T0 + 7 * 24 * H - MAX_CATCH_UP_H * H }, T0 + 7 * 24 * H)
check('catch-up is capped at 48 h', week.food === capped.food && week.joy === capped.joy && week.energy === capped.energy && week.smarts === capped.smarts)

// 6. Mood follows the needs and the time of day.
const noon = Date.UTC(2026, 2, 2, 12, 0)
check('happy when all good', mood({ ...baby, food: 90, joy: 90, energy: 90 }, noon) === 'happy')
check('hungry below 25', mood({ ...baby, food: 20 }, noon) === 'hungry')
check('sad below 25', mood({ ...baby, joy: 20 }, noon) === 'sad')
check('tired below 20 beats hungry', mood({ ...baby, energy: 10, food: 10 }, noon) === 'tired')
check('asleep at night whatever the needs', mood({ ...baby, food: 10 }, night) === 'sleeping')
check('ok in between', mood({ ...baby, food: 50, joy: 50, energy: 50 }, noon) === 'ok')

// 7. Care actions: effect, limits, and the night.
const hungry: Pet = { ...baby, food: 40, joy: 40, energy: 40, lastTick: noon }
const f = feed(hungry, noon)
check('feeding adds 30 and counts', f.ok && f.pet.food === 70 && f.pet.fed === 1)
check('cannot overfeed', !feed({ ...hungry, food: 95 }, noon).ok)
const p = play(hungry, noon)
check('playing adds joy, costs energy, counts toward play', p.ok && p.pet.joy === 65 && p.pet.energy === 25 && p.pet.played === 1 && p.pet.carePlay === 1)
check('too tired to play', !play({ ...hungry, energy: 10 }, noon).ok)
check('resting restores energy', (() => { const r = rest({ ...hungry, energy: 30 }, noon); return r.ok && r.pet.energy === 65 && r.pet.rested === 1 })())
check('no care while asleep', !feed({ ...baby, lastTick: night }, night).ok && !play({ ...baby, lastTick: night }, night).ok && !rest({ ...baby, lastTick: night }, night).ok)
check('refusals do not change the pet beyond catching up', (() => { const r = feed({ ...hungry, food: 95 }, noon); return !r.ok && r.pet.food === 95 })())

// 8. Growth by UK days, and the adult form comes from how you cared.
const born = Date.UTC(2026, 2, 2, 11, 0)
const grow = (carePlay: number, careScholar: number, days: number) =>
  tick({ ...named, stage: 'baby', hatchedAt: born, lastTick: born, eggAt: born - HATCH_MS, carePlay, careScholar }, born + days * 24 * H)
check('baby stays baby before day 3', grow(0, 0, CHILD_AT_DAY - 1).stage === 'baby')
check('child from day 3', grow(0, 0, CHILD_AT_DAY).stage === 'child')
check('adult from day 10', grow(0, 0, ADULT_AT_DAY).stage === 'adult')
check('play-heavy adult is a sprite', grow(5, 1, ADULT_AT_DAY).form === 'sprite')
check('word-heavy adult is a scholar', grow(1, 5, ADULT_AT_DAY).form === 'scholar')
check('balanced adult is plain', grow(3, 3, ADULT_AT_DAY).form === 'plain')
check('age in whole UK days', ageDays(grow(0, 0, 4), born + 4 * 24 * H) === 4)

// 9. Learning words: once per day, only when really shown, newest first, capped at five.
let w = learnWord(named, 'ephemeral', '2026-03-02')
check('learns a word', w.words === 1 && w.lastWords[0] === 'ephemeral' && w.smarts === 10 && w.careScholar === 1)
check('same day learns nothing more', learnWord(w, 'other', '2026-03-02').words === 1)
for (let i = 0; i < 7; i++) w = learnWord(w, `w${i}`, `2026-03-0${3 + i}`)
check('keeps the five newest', w.lastWords.length === 5 && w.lastWords[0] === 'w6' && w.words === 8)
check('an egg learns nothing', learnWord(egg, 'x', '2026-03-02').words === 0)

// 10. Real use is rewarded once per UK day, per kind.
const today = '2026-03-02'
const act: Activity = { arcadeDay: today, discoverDay: today, visits: [today] }
const rewarded = applyActivity({ ...named, joy: 50, smarts: 10 }, act, today)
check('arcade visit adds joy', rewarded.joy === 70 && rewarded.carePlay === 1)
check('discover visit adds smarts', rewarded.smarts === 25 && rewarded.careScholar === 1)
check('rewards are not repeated', applyActivity(rewarded, act, today).joy === 70)
check('yesterday does not count', applyActivity({ ...named, joy: 50 }, { ...act, arcadeDay: '2026-03-01' }, today).joy === 50)
check('an egg is not rewarded', applyActivity(egg, act, today).joy === 80)

// 11. Streaks.
check('no visits', streak([], today) === 0)
check('today only', streak([today], today) === 1)
check('three in a row', streak(['2026-02-28', '2026-03-01', today], today) === 3)
check('streak survives until you have missed a whole day', streak(['2026-02-28', '2026-03-01'], today) === 2)
check('a gap breaks it', streak(['2026-02-26', '2026-03-01', today], today) === 2)
check('month boundary', streak(['2026-02-28', '2026-03-01'], '2026-03-01') === 2)

// 12. Thoughts come from real events.
check('egg thought mentions time', thought(egg, none, today, T0).includes('60 min'))
check('unnamed asks for a name', thought(baby, none, today, noon) === 'Hello! What is my name?')
check('learned word is mentioned', thought({ ...named, lastWordDay: today, lastWords: ['ephemeral'], food: 90, joy: 90, energy: 90 }, none, today, noon).includes('ephemeral'))
check('suggests the Arcade', thought({ ...named, food: 90, joy: 90, energy: 90 }, none, today, noon) === 'Shall we visit the Arcade?')
check('asleep thought', thought(named, none, today, night).startsWith('Zzz'))

// 13. Saves are validated.
check('a good save parses', parsePet(JSON.parse(JSON.stringify(named))) !== null)
check('wrong schema rejected', parsePet({ ...named, schema: 2 }) === null)
check('out-of-range stat rejected', parsePet({ ...named, food: 101 }) === null)
check('unknown name rejected', parsePet({ ...named, name: 'Rex' }) === null)
check('egg with a hatch time rejected', parsePet({ ...egg, hatchedAt: 5 }) === null)
check('hatched without a hatch time rejected', parsePet({ ...named, hatchedAt: null }) === null)
check('too many words rejected', parsePet({ ...named, lastWords: ['a', 'b', 'c', 'd', 'e', 'f'] }) === null)
check('not an object rejected', parsePet('x') === null && parsePet(null) === null)

// 14. Sprites: every stage, form and mood is a clean 16x16 grid using only known characters.
let sprites = 0
for (const stage of ['egg', 'baby', 'child', 'adult'] as const) {
  for (const form of ['plain', 'scholar', 'sprite'] as const) {
    for (const m of ['sleeping', 'tired', 'hungry', 'sad', 'happy', 'ok'] as const) {
      for (const cracking of [false, true]) {
        const rows = sprite(stage, form, m, { cracking })
        sprites += 1
        check(`sprite ${stage}/${form}/${m} is ${GRID}x${GRID}`, rows.length === GRID && rows.every((r) => r.length === GRID && /^[#o.]+$/.test(r)))
        check(`sprite ${stage}/${form}/${m} has ink`, rows.some((r) => r.includes('#')))
      }
    }
  }
}
check('moods change the face', sprite('child', 'plain', 'happy').join() !== sprite('child', 'plain', 'sad').join() && sprite('baby', 'plain', 'ok').join() !== sprite('baby', 'plain', 'sleeping').join())
check('forms differ', sprite('adult', 'scholar', 'ok').join() !== sprite('adult', 'sprite', 'ok').join())
check('twelve names offered', NAMES.length === 12 && new Set(NAMES).size === 12)

console.log(`rules.check: ${checks} checks passed (${sprites} sprites)`)
