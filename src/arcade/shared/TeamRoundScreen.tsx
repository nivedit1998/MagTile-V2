import { useEffect, useMemo, useRef, useState } from 'react'
import { type Card, type Category, buildPool } from '../content/banks'
import { GameBar, Notice } from './GameFrame'
import {
  MIN_POOL, SECONDS_OPTIONS, TURNS_OPTIONS, UNLIMITED, cardToken, finishTurn, isUnlimited, markCorrect, markPass, newRounds, nextTurn,
  parseRoundSettings, parseRoundState, pauseTurn, ranking, reconcile, resumeTurn, startTurn, teamOf, totalTurns,
  type Result, type RoundSettings, type RoundState,
} from './rounds'
import { displaySeconds, isExpired, remaining } from './timer'
import { useGameSave } from './useGameSave'
import { useNow } from './useNow'

export interface TeamGameConfig {
  gameId: string
  title: string
  version: number
  categories: readonly Category[]
  rules: string
  /** Who holds the device, for the hand-off screen. */
  holder: string
  defaultCategories: readonly string[]
}

const browserRandom = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296

interface Props {
  config: TeamGameConfig
  onExit: () => void
}

export default function TeamRoundScreen({ config, onExit }: Props) {
  const knownIds = useMemo(() => config.categories.map((c) => c.id), [config])
  const parse = useMemo(
    () => (rawSettings: unknown, rawState: unknown) => {
      const settings = parseRoundSettings(rawSettings, knownIds)
      if (!settings) return null
      const state = parseRoundState(rawState, settings, buildPool(config.categories, settings.categoryIds).length)
      return state ? { settings, state } : null
    },
    [config, knownIds],
  )
  const { loading, saved, warning, save, clear } = useGameSave<RoundSettings, RoundState>(config.gameId, config.version, parse)

  // Setup form
  const [teamTotal, setTeamTotal] = useState<number>(2)
  const teamNames = useMemo(() => Array.from({ length: teamTotal }, (_, i) => `Team ${i + 1}`), [teamTotal])
  const [turns, setTurns] = useState<number>(2)
  const [seconds, setSeconds] = useState<number>(60)
  const [cats, setCats] = useState<string[]>(() => {
    const d = config.defaultCategories.filter((id) => knownIds.includes(id))
    return d.length ? d : knownIds.slice(0, 2)
  })
  const [setupNote, setSetupNote] = useState<string | null>(null)
  const [confirmNew, setConfirmNew] = useState(false)

  // Play
  const [settings, setSettings] = useState<RoundSettings | null>(null)
  const [state, setState] = useState<RoundState | null>(null)
  const [pool, setPool] = useState<Card[]>([])
  const [menu, setMenu] = useState<'closed' | 'open' | 'confirm'>('closed')
  const [covered, setCovered] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const stateRef = useRef<RoundState | null>(null)

  const playing = state?.phase === 'playing'
  const now = useNow(playing)

  const commit = (next: RoundState, s: RoundSettings) => {
    stateRef.current = next
    setState(next)
    if (next.phase === 'over') void clear()
    else void save(s, next)
  }

  const begin = (s: RoundSettings, newSession: boolean) => {
    const cards = buildPool(config.categories, s.categoryIds)
    const st = newRounds(s, cards.length, browserRandom)
    stateRef.current = st
    setSettings(s)
    setPool(cards)
    setState(st)
    setMenu('closed')
    setCovered(false)
    setNotice(null)
    void save(s, st, newSession)
  }

  const act = (fn: (s: RoundState, cfg: RoundSettings) => Result<RoundState>) => {
    const cur = stateRef.current
    if (!cur || !settings) return
    const r = fn(cur, settings)
    if (!r.ok) return
    if (r.state.deck.reshuffles > cur.deck.reshuffles) setNotice('All cards used. The deck was reshuffled.')
    commit(r.state, settings)
  }

  // End the turn at the exact deadline (not only on the 1 s display tick) and after sleep.
  useEffect(() => {
    if (!settings || !state || state.phase !== 'playing' || state.timer.endsAt === null) return
    const fire = () => {
      const cur = stateRef.current
      if (!cur) return
      const next = reconcile(cur, Date.now())
      if (next !== cur) commit(next, settings)
    }
    const wait = state.timer.endsAt - Date.now()
    if (wait <= 0) {
      fire()
      return
    }
    const id = window.setTimeout(fire, wait)
    return () => window.clearTimeout(id)
    // commit is stable enough for this effect: it only reads refs and the current settings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.phase, state?.timer.endsAt, settings])

  // Safety net: the exact-deadline timeout above can be delayed or lost (device sleep, a throttled or suspended page,
  // a clock jump). The 1 s display tick and the return from a hidden page also end an expired turn, so it can never
  // be left at 0s with the buttons disabled.
  useEffect(() => {
    const cur = stateRef.current
    if (!settings || !cur || cur.phase !== 'playing') return
    const next = reconcile(cur, Date.now())
    if (next !== cur) commit(next, settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now])

  // Cover the card when the page is hidden mid-turn, and after resuming a saved game.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && stateRef.current?.phase === 'playing') setCovered(true)
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [])

  const header = (back: string, onBack: () => void) => <GameBar title={config.title} backLabel={back} onBack={onBack} />

  if (loading) {
    return (
      <div className="arc-game">
        {header('‹ ARCADE', onExit)}
        <div className="arc-body arc-center"><p className="arc-text">Loading…</p></div>
      </div>
    )
  }

  // ---- Setup -----------------------------------------------------------------
  if (!state || !settings) {
    const poolSize = buildPool(config.categories, cats).length
    const startNew = () => {
      setSetupNote(null)
      if (cats.length === 0) return setSetupNote('Pick at least one category.')
      if (poolSize < MIN_POOL) return setSetupNote(`Not enough cards (${poolSize}). Pick more categories.`)
      if (saved.kind === 'ok' && !confirmNew) {
        setConfirmNew(true)
        return
      }
      begin({ teams: teamNames, turnsPerTeam: turns, turnSeconds: seconds, categoryIds: cats }, true)
    }
    return (
      <div className="arc-game">
        {header('‹ ARCADE', onExit)}
        <div className="arc-body">
          {saved.kind === 'ok' ? (
            <div className="arc-card">
              <p className="arc-lead">Saved game</p>
              <p className="arc-text">
                {saved.settings.teams.join(' vs ')} · turn {saved.state.turn + 1} of {totalTurns(saved.settings)}
              </p>
              <button
                type="button"
                className="arc-btn arc-primary"
                onClick={() => {
                  const cards = buildPool(config.categories, saved.settings.categoryIds)
                  // Time that passed while closed counts; the card stays hidden until tapped.
                  const next = reconcile(saved.state, Date.now())
                  stateRef.current = next
                  setSettings(saved.settings)
                  setPool(cards)
                  setState(next)
                  setCovered(next.phase === 'playing')
                  if (next !== saved.state) void save(saved.settings, next)
                }}
              >
                Resume game
              </button>
            </div>
          ) : null}
          {saved.kind === 'bad' ? <Notice>{saved.reason} Starting a new game replaces it.</Notice> : null}

          <p className="arc-lead">{config.title}</p>
          <p className="arc-text arc-rules">{config.rules}</p>

          <div className="arc-seg" role="group" aria-label="Number of teams">
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={teamTotal === n}
                className={teamTotal === n ? 'selected' : ''}
                onClick={() => setTeamTotal(n)}
              >
                {n} teams
              </button>
            ))}
          </div>

          <div className="arc-row2">
          <div className="arc-field">
            <span>Turns per team</span>
            <div className="arc-seg" role="group" aria-label="Turns per team">
              {TURNS_OPTIONS.map((n) => (
                <button key={n} type="button" aria-pressed={turns === n} className={turns === n ? 'selected' : ''} onClick={() => setTurns(n)}>{n}</button>
              ))}
            </div>
          </div>
          <div className="arc-field">
            <span>Seconds per turn</span>
            <div className="arc-seg" role="group" aria-label="Seconds per turn">
              {SECONDS_OPTIONS.map((n) => (
                <button key={n} type="button" aria-pressed={seconds === n} className={seconds === n ? 'selected' : ''} onClick={() => setSeconds(n)}>{n === UNLIMITED ? 'No limit' : `${n}s`}</button>
              ))}
            </div>
          </div>
          </div>

          <div className="arc-field">
            <span>Categories · {poolSize} cards</span>
            <div className="cat-list" role="group" aria-label="Categories">
              {config.categories.map((c) => {
                const on = cats.includes(c.id)
                const empty = c.cards.length === 0
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`cat-chip${on ? ' on' : ''}`}
                    aria-pressed={on}
                    disabled={empty}
                    onClick={() => setCats((cur) => (cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id]))}
                  >
                    <span>{on ? '✓ ' : ''}{c.name}</span>
                    <small>{empty ? 'no cards yet' : `${c.cards.length} cards`}</small>
                  </button>
                )
              })}
            </div>
          </div>

          {setupNote ? <Notice>{setupNote}</Notice> : null}
          {confirmNew ? <Notice>This replaces your saved game.</Notice> : null}
          <div className="arc-spacer" />
          <button type="button" className="arc-btn arc-primary" onClick={startNew}>{confirmNew ? 'Replace and start' : 'Start game'}</button>
        </div>
      </div>
    )
  }

  // ---- Play ------------------------------------------------------------------
  const teamCount = settings.teams.length
  const team = teamOf(state, teamCount)
  const unlimited = isUnlimited(settings)
  const left = remaining(state.timer, state.phase === 'playing' ? now : Date.now())
  const expiredNow = state.phase === 'playing' && isExpired(state.timer, now)
  const showMenu = menu !== 'closed' || state.phase === 'paused'
  const card = state.card === null ? null : pool[state.card]

  const scoreboard = (
    <div className="arc-score" aria-label="Scores">
      {settings.teams.map((name, i) => (
        <div key={i} className={`arc-score-row${state.phase !== 'over' && i === team ? ' on-turn' : ''}`}>
          <span className="arc-mark">{i + 1}</span>
          <span className="arc-name">{name}</span>
          <span className="arc-wins">{state.scores[i]}</span>
        </div>
      ))}
    </div>
  )

  let body: React.ReactNode
  if (state.phase === 'over') {
    const ranks = ranking(state.scores)
    const top = ranks.filter((r) => r.rank === 1)
    body = (
      <div className="arc-body arc-center">
        <p className="arc-kicker">GAME OVER</p>
        <p className="arc-big" role="status">
          {top.length > 1 ? `Tie: ${top.map((r) => settings.teams[r.team]).join(' & ')}` : `${settings.teams[top[0].team]} wins`}
        </p>
        <table className="arc-table">
          <tbody>
            {ranks.map((r) => (
              <tr key={r.team}>
                <th scope="row">{r.rank}. {settings.teams[r.team]}</th>
                <td>{r.score} {r.score === 1 ? 'point' : 'points'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => begin(settings, true)}>Play again</button>
        <button type="button" className="arc-btn" onClick={onExit}>Back to Arcade</button>
      </div>
    )
  } else if (state.phase === 'ready') {
    body = (
      <>
        {scoreboard}
        <div className="arc-body arc-center">
          <p className="arc-kicker">TURN {state.turn + 1} OF {totalTurns(settings)}</p>
          <p className="arc-big">{settings.teams[team]}</p>
          <p className="arc-text">Pass the device to {config.holder} for {settings.teams[team]}. The first card appears when you start.</p>
          {notice ? <Notice>{notice}</Notice> : null}
          <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => { setNotice(null); act((s, cfg) => startTurn(s, cfg, Date.now(), browserRandom)) }}>
            {unlimited ? 'Start turn' : `Start ${settings.turnSeconds}s turn`}
          </button>
        </div>
      </>
    )
  } else if (state.phase === 'summary') {
    const last = state.turn + 1 >= totalTurns(settings)
    body = (
      <>
        {scoreboard}
        <div className="arc-body">
          <p className="arc-kicker">{unlimited ? 'TURN ENDED' : 'TIME’S UP'} · {settings.teams[team].toUpperCase()}</p>
          <p className="arc-big">+{state.correct.length}</p>
          <p className="arc-text">
            {state.correct.length} correct · {state.passed.length} passed{state.skipped.length ? ` · ${state.skipped.length} unfinished` : ''}
          </p>
          <ul className="card-list" aria-label="Cards this turn">
            {state.correct.map((c, i) => <li key={`c${i}`}><b>✓</b> {pool[c].text}</li>)}
            {state.passed.map((c, i) => <li key={`p${i}`}><b>–</b> {pool[c].text}</li>)}
          </ul>
          <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => act((s, cfg) => nextTurn(s, cfg))}>
            {last ? 'See result' : `Next: ${settings.teams[(state.turn + 1) % teamCount]}`}
          </button>
        </div>
      </>
    )
  } else if (covered) {
    body = (
      <div className="arc-body arc-center">
        <p className="arc-kicker">{settings.teams[team].toUpperCase()} · TURN IN PROGRESS</p>
        <p className="arc-big" aria-live="off">{unlimited ? 'No time limit' : `${displaySeconds(left)}s left`}</p>
        <p className="arc-text">{unlimited ? 'The card is hidden. Tap to show it again.' : 'The card is hidden. Tap to show it again; the clock keeps running.'}</p>
        <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => setCovered(false)}>Show card</button>
      </div>
    )
  } else if (state.phase === 'playing') {
    const token = cardToken(state)
    body = (
      <>
        {scoreboard}
        {notice ? <Notice>{notice}</Notice> : null}
        <div className="round-card" role="group" aria-label="Current card">
          {unlimited ? <p className="round-timer round-untimed">NO TIME LIMIT</p> : <p className="round-timer" aria-label={`${displaySeconds(left)} seconds left`}>{displaySeconds(left)}s</p>}
          <p className="round-text">{card?.text}</p>
          {card?.meta ? <p className="round-meta">{card.meta}</p> : null}
        </div>
        <div className="round-actions">
          <button type="button" className="arc-btn" disabled={expiredNow} onClick={() => act((s, cfg) => markPass(s, cfg, token, Date.now(), browserRandom))}>Pass</button>
          <button type="button" className="arc-btn arc-primary" disabled={expiredNow} autoFocus onClick={() => act((s, cfg) => markCorrect(s, cfg, token, Date.now(), browserRandom))}>Correct +1</button>
        </div>
        {unlimited ? (
          <div className="round-end">
            <button type="button" className="arc-btn" onClick={() => act((s) => finishTurn(s))}>End turn</button>
          </div>
        ) : null}
      </>
    )
  } else {
    body = null // paused: the menu overlay covers everything and the card is not rendered
  }

  const bar =
    state.phase === 'playing'
      ? header('‹ PAUSE', () => act((s) => pauseTurn(s, Date.now())))
      : state.phase === 'over'
        ? header('‹ ARCADE', onExit)
        : header('‹ MENU', () => setMenu('open'))

  return (
    <div className="arc-game">
      <div className="arc-contents" inert={showMenu}>
        {bar}
        {warning ? <Notice>Progress can’t be saved on this device right now. Playing without saving.</Notice> : null}
        <div className="arc-play">{body}</div>
      </div>

      {showMenu ? (
        <div className="arc-overlay" role="dialog" aria-modal="true" aria-label="Game menu">
          {menu !== 'confirm' ? (
            <>
              <p className="arc-lead">{state.phase === 'paused' ? 'Paused' : 'Menu'}</p>
              <p className="arc-text">
                {state.phase === 'paused' ? (unlimited ? 'The card is hidden. ' : `${displaySeconds(remaining(state.timer, now))}s left. The card is hidden. `) : ''}Progress is saved on this device.
              </p>
              <button
                type="button"
                className="arc-btn arc-primary"
                autoFocus
                onClick={() => {
                  if (state.phase === 'paused') act((s) => resumeTurn(s, Date.now()))
                  setMenu('closed')
                }}
              >
                {state.phase === 'paused' ? 'Resume turn' : 'Continue'}
              </button>
              <button type="button" className="arc-btn" onClick={onExit}>Leave to Arcade</button>
              <button type="button" className="arc-btn" onClick={() => setMenu('confirm')}>Abandon game…</button>
            </>
          ) : (
            <>
              <p className="arc-lead">Abandon this game?</p>
              <p className="arc-text">The saved game and scores will be deleted.</p>
              <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => setMenu('open')}>Keep playing</button>
              <button type="button" className="arc-btn" onClick={() => { void clear(); setMenu('closed'); onExit() }}>Delete and leave</button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
