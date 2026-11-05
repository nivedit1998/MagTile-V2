import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { GameBar } from '../arcade/shared/GameFrame'
import { applyUpdate, useOfflineStatus } from '../arcade/offline/register'
import { stepFocus } from '../arcade/shared/hardware'
import {
  clock, isOlderThan, readDayState, ukToday, useDiscover, writeDayState,
  type Bundle, type DayState, type DiscoverState,
} from './data'
import './discover.css'

type PageId = 'news' | 'facts' | 'history' | 'trivia' | 'riddle' | 'word'
type Hw = MutableRefObject<{ next: () => void; prev: () => void } | null>

const PAGES: { id: PageId; name: string; cadence: string }[] = [
  { id: 'news', name: 'Latest News', cadence: 'HOURLY' },
  { id: 'facts', name: 'Daily Fun Facts', cadence: 'DAILY' },
  { id: 'history', name: 'Today in History', cadence: 'DAILY' },
  { id: 'trivia', name: 'Daily Trivia', cadence: 'DAILY' },
  { id: 'riddle', name: 'Daily Riddle', cadence: 'DAILY' },
  { id: 'word', name: 'Word of the Day', cadence: 'DAILY' },
]

const monthDay = (mmdd: string) => {
  const [mm, dd] = mmdd.split('-').map(Number)
  return `${dd} ${new Date(Date.UTC(2000, mm - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`.toUpperCase()
}

function preview(id: PageId, b: Bundle | null): string {
  if (!b) return 'Not downloaded yet'
  switch (id) {
    case 'news': return b.news?.sections[0]?.items[0]?.h ?? 'No headlines saved'
    case 'facts': return b.facts?.items[0]?.fact ?? 'No facts saved'
    case 'history': return b.history ? `${monthDay(b.history.date)} · ${b.history.items[0]?.year ?? ''}` : 'No events saved'
    case 'trivia': return b.trivia ? `${b.trivia.category} · ${b.trivia.difficulty}` : 'No question saved'
    case 'riddle': return b.riddle ? (b.riddle.title ?? 'A riddle for today') : 'No riddle saved'
    case 'word': return b.word?.word ?? 'No word saved'
  }
}

/** Pages through a list. Returns the visible slice and controls; also drives the hardware page keys. */
function usePager<T>(items: T[], perPage: number, hw: Hw) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(items.length / perPage))
  const safe = Math.min(page, pages - 1)
  const next = () => setPage((p) => Math.min(p + 1, pages - 1))
  const prev = () => setPage((p) => Math.max(p - 1, 0))
  const nextRef = useRef(next)
  const prevRef = useRef(prev)
  nextRef.current = next
  prevRef.current = prev
  useEffect(() => {
    hw.current = { next: () => nextRef.current(), prev: () => prevRef.current() }
    return () => {
      hw.current = null
    }
  }, [hw])
  return { page: safe, pages, slice: items.slice(safe * perPage, safe * perPage + perPage), next, prev, setPage }
}

function Pager({ page, pages, next, prev, label }: { page: number; pages: number; next: () => void; prev: () => void; label: string }) {
  return (
    <div className="dsc-pager" role="group" aria-label="Pages">
      <button type="button" className="arc-btn" onClick={prev} disabled={page === 0}>‹ Prev</button>
      <span className="dsc-pager-label" aria-live="polite">{label}</span>
      <button type="button" className="arc-btn" onClick={next} disabled={page >= pages - 1}>Next ›</button>
    </div>
  )
}

/** Where the content came from and when. Never presents a saved copy as live. */
function Foot({ source, fetchedAt, day, status }: { source: string; fetchedAt: string; day?: string; status: DiscoverState['status'] }) {
  const old = day ? day !== ukToday() : isOlderThan(fetchedAt, 3)
  return (
    <div className="dsc-foot">
      {old ? <p className="dsc-stale" role="status">{status === 'offline' ? 'Offline. ' : ''}Saved copy from {clock(fetchedAt)}. {day ? 'New items arrive when you are online.' : 'Newer headlines arrive when you are online.'}</p> : null}
      <p className="dsc-source">{source} · UPDATED {clock(fetchedAt)}</p>
    </div>
  )
}

function Empty({ what, d, onBack }: { what: string; d: DiscoverState; onBack: () => void }) {
  const text = d.status === 'loading' ? 'Downloading…' : d.status === 'offline' ? 'You are offline and nothing is saved yet. Connect to Wi‑Fi to download.' : d.status === 'failed' ? (d.detail ?? 'The download failed.') : `No ${what} saved yet.`
  return (
    <div className="arc-body arc-center">
      <p className="arc-lead">Nothing here yet</p>
      <p className="arc-text" role="status">{text}</p>
      <button type="button" className="arc-btn arc-primary" onClick={() => void d.refresh()}>Download now</button>
      <button type="button" className="arc-btn" onClick={onBack}>Back to Discover</button>
    </div>
  )
}

// ---- pages ------------------------------------------------------------------------------------

function NewsPage({ d, hw, onBack }: { d: DiscoverState; hw: Hw; onBack: () => void }) {
  const news = d.bundle?.news
  const [sectionId, setSectionId] = useState('top')
  const section = news?.sections.find((s) => s.id === sectionId) ?? news?.sections[0]
  const pager = usePager(section?.items ?? [], 3, hw)
  return (
    <div className="arc-game">
      <GameBar title="Latest News" backLabel="‹ DISCOVER" onBack={onBack} rightLabel={d.status === 'loading' ? '…' : 'REFRESH'} onRight={() => void d.refresh()} />
      {!news || !section ? <Empty what="headlines" d={d} onBack={onBack} /> : (
        <div className="dsc-body">
          <div className="arc-seg arc-wrap dsc-sections" role="group" aria-label="News sections">
            {news.sections.map((s) => (
              <button key={s.id} type="button" aria-pressed={s.id === section.id} className={s.id === section.id ? 'selected' : ''} onClick={() => { setSectionId(s.id); pager.setPage(0) }}>{s.name}</button>
            ))}
          </div>
          {section.items.length === 0 ? (
            <div className="dsc-empty"><p className="arc-text">No {section.name.toLowerCase()} stories in the latest BBC headlines.</p></div>
          ) : (
            <div className="dsc-items">
              {pager.slice.map((it) => (
                <article key={it.h} className="dsc-news">
                  <h3>{it.h}</h3>
                  {it.s ? <p>{it.s}</p> : null}
                  {it.t ? <span>{clock(it.t)}</span> : null}
                </article>
              ))}
            </div>
          )}
          <Pager page={pager.page} pages={pager.pages} next={pager.next} prev={pager.prev} label={section.items.length ? `${pager.page * 3 + 1}–${Math.min(pager.page * 3 + 3, section.items.length)} of ${section.items.length}` : '0 stories'} />
          <Foot source={news.source.toUpperCase()} fetchedAt={news.fetchedAt} status={d.status} />
        </div>
      )}
    </div>
  )
}

function FactsPage({ d, hw, onBack }: { d: DiscoverState; hw: Hw; onBack: () => void }) {
  const facts = d.bundle?.facts
  const pager = usePager(facts?.items ?? [], 1, hw)
  const item = pager.slice[0]
  return (
    <div className="arc-game">
      <GameBar title="Daily Fun Facts" backLabel="‹ DISCOVER" onBack={onBack} />
      {!facts || !item ? <Empty what="facts" d={d} onBack={onBack} /> : (
        <div className="dsc-body">
          <p className="arc-kicker">DID YOU KNOW…</p>
          <p className="dsc-fact">{item.fact}</p>
          {item.about ? <div className="dsc-about"><p className="arc-kicker">{item.title.toUpperCase()}{item.category ? ` · ${item.category.toUpperCase()}` : ''}</p><p className="arc-text">{item.about}</p></div> : null}
          <div className="arc-spacer" />
          <Pager page={pager.page} pages={pager.pages} next={pager.next} prev={pager.prev} label={`Fact ${pager.page + 1} of ${pager.pages}`} />
          <Foot source={facts.source.toUpperCase()} fetchedAt={facts.fetchedAt} day={facts.day} status={d.status} />
        </div>
      )}
    </div>
  )
}

function HistoryPage({ d, hw, onBack }: { d: DiscoverState; hw: Hw; onBack: () => void }) {
  const history = d.bundle?.history
  const pager = usePager(history?.items ?? [], 3, hw)
  return (
    <div className="arc-game">
      <GameBar title="Today in History" backLabel="‹ DISCOVER" onBack={onBack} />
      {!history ? <Empty what="events" d={d} onBack={onBack} /> : (
        <div className="dsc-body">
          <p className="arc-kicker">ON THIS DAY · {monthDay(history.date)}</p>
          <div className="dsc-items">
            {pager.slice.map((e) => (
              <article key={`${e.year}-${e.text.slice(0, 20)}`} className="dsc-event">
                <strong>{e.year}</strong>
                <p>{e.text}</p>
              </article>
            ))}
          </div>
          <Pager page={pager.page} pages={pager.pages} next={pager.next} prev={pager.prev} label={`${pager.page + 1} of ${pager.pages}`} />
          <Foot source={history.source.toUpperCase()} fetchedAt={history.fetchedAt} day={history.day} status={d.status} />
        </div>
      )}
    </div>
  )
}

function TriviaPage({ d, day, setDay, onBack }: { d: DiscoverState; day: DayState; setDay: (s: DayState) => void; onBack: () => void }) {
  const t = d.bundle?.trivia
  if (!t) return <div className="arc-game"><GameBar title="Daily Trivia" backLabel="‹ DISCOVER" onBack={onBack} /><Empty what="question" d={d} onBack={onBack} /></div>
  const same = day.day === t.day
  const pick = same ? day.triviaPick : null
  const revealed = same && (day.triviaRevealed || pick !== null)
  const answer = (patch: Partial<DayState>) => setDay({ ...day, day: t.day, triviaPick: pick, triviaRevealed: revealed, ...patch })
  return (
    <div className="arc-game">
      <GameBar title="Daily Trivia" backLabel="‹ DISCOVER" onBack={onBack} />
      <div className="dsc-body">
        <p className="arc-kicker">{t.category.toUpperCase()} · {t.difficulty.toUpperCase()}</p>
        <p className="dsc-question">{t.question}</p>
        <div className="dsc-options" role="group" aria-label="Answers">
          {t.options.map((o, i) => {
            const right = revealed && i === t.answer
            const wrong = revealed && pick === i && i !== t.answer
            return (
              <button key={o} type="button" className={`arc-btn dsc-option${right ? ' right' : ''}${wrong ? ' wrong' : ''}`} aria-disabled={revealed || undefined} onClick={() => { if (!revealed) answer({ triviaPick: i, triviaRevealed: true }) }}>
                <span>{o}</span><b aria-hidden="true">{right ? '✓' : wrong ? '✗' : ''}</b>
              </button>
            )
          })}
        </div>
        <p className="arc-text dsc-result" role="status">{revealed ? (pick === null ? `The answer is ${t.options[t.answer]}.` : pick === t.answer ? 'Correct!' : `Not quite. The answer is ${t.options[t.answer]}.`) : 'Tap an answer, or reveal it.'}</p>
        <div className="arc-spacer" />
        {!revealed ? <button type="button" className="arc-btn arc-primary" onClick={() => answer({ triviaRevealed: true })}>Reveal answer</button> : null}
        <Foot source={t.source.toUpperCase()} fetchedAt={t.fetchedAt} day={t.day} status={d.status} />
      </div>
    </div>
  )
}

function RiddlePage({ d, day, setDay, onBack }: { d: DiscoverState; day: DayState; setDay: (s: DayState) => void; onBack: () => void }) {
  const r = d.bundle?.riddle
  if (!r) return <div className="arc-game"><GameBar title="Daily Riddle" backLabel="‹ DISCOVER" onBack={onBack} /><Empty what="riddle" d={d} onBack={onBack} /></div>
  const shown = day.day === r.day && day.riddleRevealed
  return (
    <div className="arc-game">
      <GameBar title="Daily Riddle" backLabel="‹ DISCOVER" onBack={onBack} />
      <div className="dsc-body">
        <p className="arc-kicker">{r.title ? r.title.toUpperCase() : 'TODAY’S RIDDLE'}</p>
        <p className="dsc-question">{r.question}</p>
        <div className="arc-spacer" />
        {shown ? <div className="dsc-answer" role="status"><p className="arc-kicker">ANSWER</p><p className="dsc-answer-text">{r.answer}</p></div> : null}
        <button type="button" className={`arc-btn${shown ? '' : ' arc-primary'}`} onClick={() => setDay({ ...day, day: r.day, riddleRevealed: !shown })}>{shown ? 'Hide answer' : 'Reveal answer'}</button>
        <Foot source={r.source.toUpperCase()} fetchedAt={r.fetchedAt} day={r.day} status={d.status} />
      </div>
    </div>
  )
}

function WordPage({ d, onBack }: { d: DiscoverState; onBack: () => void }) {
  const w = d.bundle?.word
  return (
    <div className="arc-game">
      <GameBar title="Word of the Day" backLabel="‹ DISCOVER" onBack={onBack} />
      {!w ? <Empty what="word" d={d} onBack={onBack} /> : (
        <div className="dsc-body">
          <p className="arc-kicker">WORD OF THE DAY{w.partOfSpeech ? ` · ${w.partOfSpeech.toUpperCase()}` : ''}</p>
          <p className="dsc-word">{w.word}</p>
          <p className="dsc-def">{w.definition}</p>
          {w.example ? <p className="dsc-example">“{w.example}”</p> : null}
          <div className="arc-spacer" />
          <Foot source={w.source.toUpperCase()} fetchedAt={w.fetchedAt} day={w.day} status={d.status} />
        </div>
      )}
    </div>
  )
}

// ---- screen -----------------------------------------------------------------------------------

export default function DiscoverScreen() {
  const d = useDiscover()
  const offline = useOfflineStatus()
  const [page, setPage] = useState<PageId | null>(null)
  const [day, setDayState] = useState<DayState>(() => readDayState(ukToday()))
  const gameRef = useRef<HTMLElement>(null)
  const hw: Hw = useRef(null)
  const lastOpened = useRef<PageId | null>(null)

  const setDay = (s: DayState) => {
    setDayState(s)
    writeDayState(s)
  }
  const open = (id: PageId) => {
    lastOpened.current = id
    setPage(id)
  }

  // Back on the list: focus the tile that was opened.
  useEffect(() => {
    if (page || !gameRef.current || !lastOpened.current) return
    gameRef.current.querySelector<HTMLElement>(`[data-page="${lastOpened.current}"]`)?.focus({ preventScroll: true })
  }, [page])

  // Hardware page buttons: step through pages when a page has them, otherwise step through the controls.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'PageDown' && event.key !== 'PageUp') return
      event.preventDefault()
      const forward = event.key === 'PageDown'
      if (hw.current) {
        if (forward) hw.current.next()
        else hw.current.prev()
      } else if (gameRef.current) {
        stepFocus(gameRef.current, forward ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const back = () => setPage(null)
  const body = useMemo(() => {
    switch (page) {
      case 'news': return <NewsPage d={d} hw={hw} onBack={back} />
      case 'facts': return <FactsPage d={d} hw={hw} onBack={back} />
      case 'history': return <HistoryPage d={d} hw={hw} onBack={back} />
      case 'trivia': return <TriviaPage d={d} day={day} setDay={setDay} onBack={back} />
      case 'riddle': return <RiddlePage d={d} day={day} setDay={setDay} onBack={back} />
      case 'word': return <WordPage d={d} onBack={back} />
      default: return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, d.bundle, d.status, d.detail, day])

  if (page) return <section className="arcade-screen discover-screen" aria-label={PAGES.find((p) => p.id === page)?.name} ref={gameRef}>{body}</section>

  const stamp = d.bundle ? clock(d.bundle.generatedAt) : ''
  const note =
    d.status === 'loading' ? 'Downloading the latest…'
    : d.status === 'offline' ? `Offline. Saved copy${stamp ? ` from ${stamp}` : ''}.`
    : d.status === 'failed' ? `Couldn’t update. ${d.bundle ? `Saved copy from ${stamp}.` : (d.detail ?? '')}`
    : d.bundle ? `Updated ${stamp}` : 'Nothing downloaded yet'
  return (
    <section className="arcade-screen discover-screen" aria-label="Discover" ref={gameRef}>
      {offline.updateWaiting ? (
        <div className="arcade-update" role="status">
          <span>App update ready. Saved games are kept.</span>
          <button type="button" onClick={applyUpdate}>Update now</button>
        </div>
      ) : null}
      <div className="arcade-update" role="status">
        <span>{note}</span>
        <button type="button" onClick={() => void d.refresh()} disabled={d.status === 'loading'}>Refresh</button>
      </div>
      <div className="arcade-game-list" role="group" aria-label="Discover pages">
        {PAGES.map((p, i) => (
          <button className="arcade-game-tile dsc-tile" data-page={p.id} key={p.id} onClick={() => open(p.id)} type="button">
            <span className="arcade-game-number">{String(i + 1).padStart(2, '0')}</span>
            <span className="arcade-game-name">{p.name}</span>
            <span className="arcade-game-description dsc-preview">{preview(p.id, d.bundle)}</span>
            <span className="arcade-game-type">{p.cadence}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
