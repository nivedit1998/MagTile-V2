import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GameBar } from '../arcade/shared/GameFrame'
import { applyUpdate, useOfflineStatus } from '../arcade/offline/register'
import { stepFocus } from '../arcade/shared/hardware'
import { readPref, writePref } from '../arcade/storage/saves'
import { readCache } from '../discover/data'
import { readActivity, recordActivity } from './activity'
import {
  NAMES, ageDays, applyActivity, chooseName, feed, learnWord, minutesToHatch, mood, newPet, parsePet, play, rest, streak, thought, tick, ukDay,
  type ActionResult, type Pet,
} from './pet/rules'
import { GRID, MOOD_MARK, sprite } from './pet/sprites'
import './mylife.css'

const PET_KEY = 'magtile.pet'

const ITEMS: { id: string; name: string; tag: string; ready: boolean; note: string }[] = [
  { id: 'pet', name: 'Virtual Pet', tag: 'PLAY', ready: true, note: '' },
  { id: 'finances', name: 'Personal Finances', tag: 'LATER', ready: false, note: 'Read-only savings and budgets. Needs a data source.' },
  { id: 'habits', name: 'Habit Tracker', tag: 'LATER', ready: false, note: 'Will use your Apple Health data.' },
  { id: 'travel', name: 'Travel & Countdown', tag: 'LATER', ready: false, note: 'A map that ticks off countries from where MagTile is.' },
]

function loadPet(now: number): Pet {
  const saved = parsePet(readPref<unknown>(PET_KEY))
  return saved ?? newPet(now)
}

/** Brings the saved pet up to date and applies what you really did today. Pure apart from reading storage. */
function refreshPet(now: number): Pet {
  const today = ukDay(now)
  let pet = tick(loadPet(now), now)
  const activity = readActivity()
  pet = applyActivity(pet, activity, today)
  if (activity.discoverDay === today) {
    const word = readCache()?.word // only a word that was really downloaded and shown today
    if (word && word.day === today) pet = learnWord(pet, word.word, today)
  }
  return pet
}

const STAGE_LABEL = { egg: 'EGG', baby: 'BABY', child: 'CHILD', adult: 'ADULT' } as const
const FORM_LABEL = { plain: '', scholar: ' · SCHOLAR', sprite: ' · SPRITE' } as const

function Sprite({ pet, now }: { pet: Pet; now: number }) {
  const m = mood(pet, now)
  const rows = sprite(pet.stage, pet.form, m, { cracking: pet.stage === 'egg' && minutesToHatch(pet, now) <= 15 })
  const rects: { x: number; y: number; w: number; c: string }[] = []
  rows.forEach((row, y) => {
    let x = 0
    while (x < GRID) {
      const c = row[x]
      if (c === '.') { x += 1; continue }
      let w = 1
      while (x + w < GRID && row[x + w] === c) w += 1
      rects.push({ x, y, w, c })
      x += w
    }
  })
  return (
    <svg className="pet-art" viewBox={`0 0 ${GRID} ${GRID}`} role="img" aria-label={`${pet.name ?? 'Your pet'}, ${pet.stage === 'egg' ? 'an egg' : `feeling ${m}`}`} shapeRendering="crispEdges">
      {rects.map((r) => <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.c === '#' ? 'var(--ink)' : 'var(--paper)'} />)}
    </svg>
  )
}

function Meter({ label, value }: { label: string; value: number }) {
  const cells = Math.round(value / 10)
  return (
    <div className="pet-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
      <span className="pet-meter-label">{label}</span>
      <span className="pet-cells" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < cells ? 'on' : ''} />)}</span>
      <span className="pet-meter-num">{Math.round(value)}</span>
    </div>
  )
}

function PetPage({ onBack }: { onBack: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  const [pet, setPetState] = useState<Pet>(() => refreshPet(Date.now()))
  const [message, setMessage] = useState<string | null>(null)
  const [activity, setActivity] = useState(() => readActivity())
  const rootRef = useRef<HTMLDivElement>(null)

  const save = useCallback((p: Pet) => {
    setPetState(p)
    writePref(PET_KEY, p)
  }, [])
  const sync = useCallback(() => {
    const t = Date.now()
    setNow(t)
    setActivity(readActivity())
    save(refreshPet(t))
  }, [save])

  // Save the freshly caught-up pet once, then wake exactly once at hatching time (no polling).
  useEffect(() => {
    recordActivity('mylife')
    sync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (pet.stage !== 'egg') return
    const wait = Math.max(1000, pet.eggAt + 60 * 60 * 1000 - Date.now())
    const id = window.setTimeout(sync, wait + 500)
    return () => window.clearTimeout(id)
  }, [pet.stage, pet.eggAt, sync])

  // Hardware page buttons step through the controls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'PageDown' && e.key !== 'PageUp') || !rootRef.current) return
      e.preventDefault()
      stepFocus(rootRef.current, e.key === 'PageDown' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const act = (fn: (p: Pet, t: number) => ActionResult) => {
    const t = Date.now()
    const r = fn(pet, t)
    setNow(t)
    setMessage(r.message)
    save(r.pet)
  }
  const today = ukDay(now)
  const m = mood(pet, now)
  const asleep = m === 'sleeping'
  const needsName = pet.stage !== 'egg' && pet.name === null
  const days = ageDays(pet, now)

  return (
    <div className="arc-game pet-page" ref={rootRef}>
      <GameBar title="Virtual Pet" backLabel="‹ MY LIFE" onBack={onBack} />
      <div className="pet-body">
        <div className="pet-head">
          <strong>{pet.name ?? (pet.stage === 'egg' ? 'MYSTERY EGG' : 'NEW PET')}</strong>
          <span>{STAGE_LABEL[pet.stage]}{FORM_LABEL[pet.form]}{pet.stage !== 'egg' ? ` · DAY ${days + 1}` : ''}</span>
        </div>
        <p className="pet-thought" role="status" aria-live="polite">{thought(pet, activity, today, now)}</p>
        <div className="pet-stage">
          <Sprite pet={pet} now={now} />
          {MOOD_MARK[m] ? <span className="pet-mark" aria-hidden="true">{MOOD_MARK[m]}</span> : null}
        </div>
        {needsName ? (
          <div className="pet-names" role="group" aria-label="Choose a name" data-page-jump="3">
            {NAMES.map((n) => <button key={n} type="button" className="arc-btn" onClick={() => save(chooseName(pet, n))}>{n}</button>)}
          </div>
        ) : pet.stage === 'egg' ? (
          <p className="pet-egg arc-text">It hatches {minutesToHatch(pet, now) > 0 ? `in about ${minutesToHatch(pet, now)} min.` : 'now.'} Open MagTile again later and it will be waiting.</p>
        ) : (
          <>
            <div className="pet-needs">
              <Meter label="FOOD" value={pet.food} />
              <Meter label="JOY" value={pet.joy} />
              <Meter label="ENERGY" value={pet.energy} />
              <Meter label="SMARTS" value={pet.smarts} />
            </div>
            <div className="pet-actions" role="group" aria-label="Care">
              <button type="button" className="arc-btn" onClick={() => act(feed)} disabled={asleep}>Feed</button>
              <button type="button" className="arc-btn" onClick={() => act(play)} disabled={asleep}>Play</button>
              <button type="button" className="arc-btn" onClick={() => act(rest)} disabled={asleep}>Rest</button>
            </div>
            <p className="pet-message" role="status" aria-live="polite">{asleep ? 'Sleeping until 07:00.' : (message ?? ' ')}</p>
            <div className="pet-facts">
              <span><b>{streak(activity.visits, today)}</b> day streak</span>
              <span><b>{pet.words}</b> words learned</span>
              <span><b>{pet.fed}</b> meals</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function MyLifeScreen() {
  const offline = useOfflineStatus()
  const [page, setPage] = useState<string | null>(null)
  const listRef = useRef<HTMLElement>(null)
  const lastOpened = useRef<string | null>(null)

  useEffect(() => {
    if (page || !listRef.current || !lastOpened.current) return
    listRef.current.querySelector<HTMLElement>(`[data-page="${lastOpened.current}"]`)?.focus({ preventScroll: true })
  }, [page])
  useEffect(() => {
    if (page) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'PageDown' && e.key !== 'PageUp') || !listRef.current) return
      e.preventDefault()
      stepFocus(listRef.current, e.key === 'PageDown' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [page])

  const summary = useMemo(() => {
    const saved = parsePet(readPref<unknown>(PET_KEY))
    if (!saved) return 'A mystery egg is waiting for you.'
    const t = Date.now()
    const p = tick(saved, t)
    if (p.stage === 'egg') return 'An egg. Hatching soon.'
    return `${p.name ?? 'New pet'} is ${mood(p, t) === 'ok' ? 'doing fine' : mood(p, t)}.`
  }, [page])

  if (page === 'pet') return <section className="arcade-screen mylife-screen" aria-label="Virtual Pet"><PetPage onBack={() => setPage(null)} /></section>

  return (
    <section className="arcade-screen mylife-screen" aria-label="My Life" ref={listRef}>
      {offline.updateWaiting ? (
        <div className="arcade-update" role="status">
          <span>App update ready. Your pet is kept.</span>
          <button type="button" onClick={applyUpdate}>Update now</button>
        </div>
      ) : null}
      <div className="arcade-game-list" role="group" aria-label="My Life pages">
        {ITEMS.map((it, i) => (
          <button
            className={`arcade-game-tile dsc-tile${it.ready ? '' : ' ml-later'}`}
            data-page={it.id}
            key={it.id}
            type="button"
            aria-disabled={!it.ready}
            onClick={() => { if (it.ready) { lastOpened.current = it.id; setPage(it.id) } }}
          >
            <span className="arcade-game-number">{String(i + 1).padStart(2, '0')}</span>
            <span className="arcade-game-name">{it.name}</span>
            <span className="arcade-game-description dsc-preview">{it.ready ? summary : it.note}</span>
            <span className="arcade-game-type">{it.tag}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
