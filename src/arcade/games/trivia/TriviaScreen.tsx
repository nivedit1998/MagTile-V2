import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useContent } from '../../content/runtime'
import type { Question, TriviaCategory } from '../../content/trivia'
import type { Random } from '../../shared/deck'
import { GameBar, Notice } from '../../shared/GameFrame'
import { ranking } from '../../shared/rounds'
import { useGameSave } from '../../shared/useGameSave'
import {
  MAX_MEMBERS, MAX_NAME, MAX_PLAYERS, MAX_TEAMS, POINTS_OPTIONS, ROUNDS_OPTIONS, answererOf, award, choose, declineTieBreak,
  newMatch, nextTurn, parseSettings, parseState, questionsNeeded, remainingQuestions, revealAnswer, showQuestion, startTieBreak, totalTurns,
  validateEntrants, winners,
  type Format, type Mode, type Result, type Settings, type State,
} from './rules'

const GAME_ID = 'trivia'
const browserRandom: Random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296
const LETTERS = ['A', 'B', 'C', 'D']

const optionText = (q: Question, id: number) => (id === 0 ? q.a : q.w[id - 1])

interface Row {
  name: string
  members: string
}

const defaultRows = (mode: Mode, n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ name: mode === 'players' ? `Player ${i + 1}` : `Team ${i + 1}`, members: mode === 'teams' ? `Member ${i * 2 + 1}, Member ${i * 2 + 2}` : '' }))

interface Props {
  onExit: () => void
}

/** Opens with one snapshot of the content (starter set or the installed pack) and keeps it for the whole session. */
export default function TriviaScreen({ onExit }: Props) {
  const content = useContent()
  if (!content) {
    return (
      <div className="arc-game">
        <GameBar title="Trivia Battle" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body arc-center"><p className="arc-text">Loading…</p></div>
      </div>
    )
  }
  return <TriviaGame onExit={onExit} categories={content.trivia.categories} version={content.trivia.version} />
}

function TriviaGame({ onExit, categories, version }: Props & { categories: readonly TriviaCategory[]; version: number }) {
  const knownIds = useMemo(() => categories.map((c) => c.id), [categories])
  const byId = useMemo(() => new Map(categories.flatMap((c) => c.questions).map((q) => [q.id, q] as const)), [categories])
  const poolIds = useCallback((ids: readonly string[]) => categories.filter((c) => ids.includes(c.id)).flatMap((c) => c.questions.map((q) => q.id)), [categories])
  const parse = useCallback(
    (rawSettings: unknown, rawState: unknown): { settings: Settings; state: State } | null => {
      const settings = parseSettings(rawSettings, knownIds)
      const state = settings ? parseState(rawState, settings, poolIds(settings.categoryIds), version) : null
      return settings && state ? { settings, state } : null
    },
    [knownIds, poolIds, version],
  )
  const { loading, saved, warning, save, clear } = useGameSave<Settings, State>(GAME_ID, version, parse)

  // Setup form
  const [mode, setMode] = useState<Mode>('players')
  const [rows, setRows] = useState<Row[]>(() => defaultRows('players', 2))
  const [format, setFormat] = useState<Format>('choice')
  const [rounds, setRounds] = useState<number>(3)
  const [points, setPoints] = useState<number>(1)
  const [cats, setCats] = useState<string[]>(() => {
    const d = ['general', 'science'].filter((id) => knownIds.includes(id))
    return d.length ? d : knownIds.slice(0, 2)
  })
  const [errors, setErrors] = useState<(string | null)[]>([])
  const [setupNote, setSetupNote] = useState<string | null>(null)
  const [confirmNew, setConfirmNew] = useState(false)

  // Play
  const [settings, setSettings] = useState<Settings | null>(null)
  const [state, setState] = useState<State | null>(null)
  const [menu, setMenu] = useState<'closed' | 'open' | 'confirm'>('closed')
  const [covered, setCovered] = useState(false)
  const stateRef = useRef<State | null>(null)

  const commit = (next: State, s: Settings) => {
    stateRef.current = next
    setState(next)
    if (next.phase === 'over') void clear()
    else void save(s, next)
  }

  const begin = (s: Settings) => {
    const st = newMatch(s, poolIds(s.categoryIds), version, browserRandom)
    stateRef.current = st
    setSettings(s)
    setState(st)
    setMenu('closed')
    setCovered(false)
    void save(s, st, true)
  }

  const act = (fn: (s: State, cfg: Settings) => Result<State>) => {
    const cur = stateRef.current
    if (!cur || !settings) return
    const r = fn(cur, settings)
    if (!r.ok) return
    // The quizmaster's revealed answer is hidden again whenever the screen changes hands.
    setCovered(false)
    commit(r.state, settings)
  }

  // Hide a revealed host answer if the page is hidden.
  useEffect(() => {
    const onHide = () => {
      const cur = stateRef.current
      if (document.hidden && cur?.phase === 'question' && cur.current?.answerShown) setCovered(true)
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [])

  const available = useMemo(() => poolIds(cats).length, [cats, poolIds])

  if (loading) {
    return (
      <div className="arc-game">
        <GameBar title="Trivia Battle" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body arc-center"><p className="arc-text">Loading…</p></div>
      </div>
    )
  }

  // ---- Setup -----------------------------------------------------------------
  if (!state || !settings) {
    const max = mode === 'players' ? MAX_PLAYERS : MAX_TEAMS
    const needed = questionsNeeded({ entrants: rows, rounds })
    const enough = available >= needed
    const switchMode = (m: Mode) => {
      setMode(m)
      setRows(defaultRows(m, 2))
      setErrors([])
    }
    const startNew = () => {
      const check = validateEntrants(mode, rows)
      setErrors(check.errors)
      setSetupNote(null)
      if (!check.ok) return
      if (cats.length === 0) return setSetupNote('Pick at least one category.')
      if (!enough) return setSetupNote(`Not enough questions: ${available} available, ${needed} needed. Pick more categories or fewer rounds.`)
      if (saved.kind === 'ok' && !confirmNew) {
        setConfirmNew(true)
        return
      }
      begin({ mode, entrants: check.entrants, format, rounds, points, categoryIds: cats })
    }
    return (
      <div className="arc-game">
        <GameBar title="Trivia Battle" backLabel="‹ ARCADE" onBack={onExit} />
        <form className="arc-body" onSubmit={(e) => { e.preventDefault(); startNew() }} noValidate>
          {saved.kind === 'ok' ? (
            <div className="arc-card">
              <p className="arc-lead">Saved match</p>
              <p className="arc-text">
                {saved.settings.entrants.map((e) => e.name).join(' vs ')} · {saved.state.cursor} of {saved.state.order.length} questions drawn
              </p>
              <button
                type="button"
                className="arc-btn arc-primary"
                onClick={() => {
                  stateRef.current = saved.state
                  setSettings(saved.settings)
                  setState(saved.state)
                  setCovered(saved.state.phase === 'question' && saved.state.current?.answerShown === true)
                }}
              >
                Resume match
              </button>
            </div>
          ) : null}
          {saved.kind === 'bad' ? <Notice>{saved.reason} Starting a new match replaces it.</Notice> : null}

          <p className="arc-text arc-rules">
            Everyone gets the same number of questions, in turn. Share one device: no speed scoring. If the top spots tie you can
            play a tie-break question each or share the win.
          </p>

          <div className="arc-seg" role="group" aria-label="Who is playing">
            <button type="button" aria-pressed={mode === 'players'} className={mode === 'players' ? 'selected' : ''} onClick={() => switchMode('players')}>Individuals</button>
            <button type="button" aria-pressed={mode === 'teams'} className={mode === 'teams' ? 'selected' : ''} onClick={() => switchMode('teams')}>Teams</button>
          </div>
          <div className="arc-seg" role="group" aria-label={mode === 'players' ? 'Number of players' : 'Number of teams'}>
            {Array.from({ length: max - 1 }, (_, i) => i + 2).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={rows.length === n}
                className={rows.length === n ? 'selected' : ''}
                onClick={() => setRows((cur) => Array.from({ length: n }, (_, i) => cur[i] ?? defaultRows(mode, n)[i]))}
              >
                {n}
              </button>
            ))}
          </div>

          {rows.map((row, i) => (
            <div className="arc-field" key={i}>
              <label>
                <span>{mode === 'players' ? `Player ${i + 1}` : `Team ${i + 1} name`}</span>
                <input
                  value={row.name}
                  maxLength={MAX_NAME}
                  autoComplete="off"
                  onChange={(e) => setRows((cur) => cur.map((r, k) => (k === i ? { ...r, name: e.target.value } : r)))}
                  aria-invalid={errors[i] != null}
                />
              </label>
              {mode === 'teams' ? (
                <label>
                  <span>Members (comma separated, up to {MAX_MEMBERS})</span>
                  <input
                    value={row.members}
                    autoComplete="off"
                    onChange={(e) => setRows((cur) => cur.map((r, k) => (k === i ? { ...r, members: e.target.value } : r)))}
                    aria-invalid={errors[i] != null}
                  />
                </label>
              ) : null}
              {errors[i] ? <em>{errors[i]}</em> : null}
            </div>
          ))}

          <div className="arc-field">
            <span>Question style</span>
            <div className="arc-seg" role="group" aria-label="Question style">
              <button type="button" aria-pressed={format === 'choice'} className={format === 'choice' ? 'selected' : ''} onClick={() => setFormat('choice')}>Multiple choice</button>
              <button type="button" aria-pressed={format === 'host'} className={format === 'host' ? 'selected' : ''} onClick={() => setFormat('host')}>Quizmaster</button>
            </div>
            <small className="tv-hint">{format === 'choice' ? 'The answerer picks from four options.' : 'A quizmaster reads each question, reveals the answer, and awards the point.'}</small>
          </div>
          <div className="arc-field">
            <span>Questions each</span>
            <div className="arc-seg" role="group" aria-label="Questions each">
              {ROUNDS_OPTIONS.map((n) => (
                <button key={n} type="button" aria-pressed={rounds === n} className={rounds === n ? 'selected' : ''} onClick={() => setRounds(n)}>{n}</button>
              ))}
            </div>
          </div>
          <div className="arc-field">
            <span>Points per correct answer</span>
            <div className="arc-seg" role="group" aria-label="Points per correct answer">
              {POINTS_OPTIONS.map((n) => (
                <button key={n} type="button" aria-pressed={points === n} className={points === n ? 'selected' : ''} onClick={() => setPoints(n)}>{n}</button>
              ))}
            </div>
          </div>

          <div className="arc-field">
            <span>Categories · {available} questions · need {needed}</span>
            <div className="cat-list" role="group" aria-label="Categories">
              {categories.map((c) => {
                const on = cats.includes(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`cat-chip${on ? ' on' : ''}`}
                    aria-pressed={on}
                    disabled={c.questions.length === 0}
                    onClick={() => setCats((cur) => (cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id]))}
                  >
                    <span>{on ? '✓ ' : ''}{c.name}</span>
                    <small>{c.questions.length === 0 ? 'no questions yet' : `${c.questions.length} questions`}</small>
                  </button>
                )
              })}
            </div>
            {!enough ? <small className="tv-hint">Not enough questions yet for this setup.</small> : null}
          </div>

          {setupNote ? <Notice>{setupNote}</Notice> : null}
          {confirmNew ? <Notice>This replaces your saved match.</Notice> : null}
          <button type="submit" className="arc-btn arc-primary">{confirmNew ? 'Replace and start' : 'Start match'}</button>
        </form>
      </div>
    )
  }

  // ---- Play ------------------------------------------------------------------
  const seq = state.seq
  const total = totalTurns(settings)
  const who = settings.entrants[state.participant]
  const answerer = answererOf(state, settings)
  const cur = state.current
  const question = cur ? byId.get(state.order[cur.q]) : undefined
  const inTieBreak = state.tie !== null
  const showMenu = menu !== 'closed'
  const unit = settings.mode === 'teams' ? 'team' : 'player'

  const scoreboard = (
    <div className="tv-score" aria-label="Scores">
      {settings.entrants.map((e, i) => (
        <div key={i} className={`tv-chip${state.phase !== 'over' && state.phase !== 'tie' && i === state.participant ? ' on-turn' : ''}`}>
          <span className="arc-name">{e.name}</span>
          <strong>{state.scores[i]}</strong>
        </div>
      ))}
    </div>
  )

  const questionBlock = question ? <p className="tv-question">{question.q}</p> : null

  let body: React.ReactNode
  if (state.phase === 'over') {
    const ranks = ranking(state.scores)
    const win = winners(state)
    body = (
      <div className="arc-body arc-center">
        <p className="arc-kicker">MATCH OVER</p>
        <p className="arc-big" role="status">{win.length > 1 ? `Shared win: ${win.map((i) => settings.entrants[i].name).join(' & ')}` : `${settings.entrants[win[0]].name} wins`}</p>
        <table className="arc-table">
          <tbody>
            {ranks.map((r) => (
              <tr key={r.team}>
                <th scope="row">{r.rank}. {settings.entrants[r.team].name}</th>
                <td>{r.score} {r.score === 1 ? 'point' : 'points'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => begin(settings)}>Play again</button>
        <button type="button" className="arc-btn" onClick={onExit}>Back to Arcade</button>
      </div>
    )
  } else if (state.phase === 'tie') {
    const tied = state.tie!.ids.map((i) => settings.entrants[i].name)
    body = (
      <>
        {scoreboard}
        <div className="arc-body arc-center">
          <p className="arc-kicker">TIE FOR THE LEAD</p>
          <p className="arc-big">{tied.join(' & ')}</p>
          <p className="arc-text">
            Level on {state.scores[state.tie!.ids[0]]}. Each tied {unit} can answer one more question, or you can share the win.
            {` ${remainingQuestions(state)} questions left.`}
          </p>
          <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => act((s) => startTieBreak(s, seq))}>Play a tie-break question each</button>
          <button type="button" className="arc-btn" onClick={() => act((s) => declineTieBreak(s, seq))}>Share the win</button>
        </div>
      </>
    )
  } else if (state.phase === 'ready') {
    body = (
      <>
        {scoreboard}
        <div className="arc-body arc-center">
          <p className="arc-kicker">{inTieBreak ? `TIE-BREAK · ROUND ${state.tie!.cycle}` : `QUESTION ${state.turn + 1} OF ${total}`}</p>
          <p className="arc-big">{who.name}</p>
          {answerer ? <p className="arc-text">Answering: <strong>{answerer}</strong></p> : null}
          <p className="arc-text">
            {settings.format === 'choice'
              ? `Pass the device to ${answerer ?? who.name}. The question appears when you start.`
              : `Quizmaster: read the question aloud to ${answerer ?? who.name}. The answer stays hidden until you reveal it.`}
          </p>
          <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => act((s) => showQuestion(s, seq))}>Show question</button>
        </div>
      </>
    )
  } else if (!question || !cur) {
    body = <div className="arc-body arc-center"><p className="arc-text">This question could not be found. Leave the match and start a new one.</p></div>
  } else if (state.phase === 'question' && covered) {
    body = (
      <>
        {scoreboard}
        <div className="arc-body arc-center">
          <p className="arc-kicker">QUIZMASTER</p>
          <p className="arc-big">Answer hidden</p>
          <p className="arc-text">The revealed answer was hidden when this screen was left. Show it again when only the quizmaster is looking.</p>
          <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => setCovered(false)}>Show answer</button>
        </div>
      </>
    )
  } else if (state.phase === 'question' && settings.format === 'choice') {
    const order = state.optionOrders[cur.q]
    body = (
      <>
        {scoreboard}
        <div className="arc-body">
          <p className="arc-kicker">{who.name.toUpperCase()}{answerer ? ` · ${answerer.toUpperCase()}` : ''}</p>
          {questionBlock}
          <div className="tv-options" role="group" aria-label="Answer options" data-page-jump={1}>
            {order.map((id, pos) => (
              <button
                key={pos}
                type="button"
                className="tv-option"
                aria-label={`Option ${LETTERS[pos]}: ${optionText(question, id)}`}
                onClick={() => act((s, cfg) => choose(s, cfg, seq, pos))}
              >
                <b>{LETTERS[pos]}</b>
                <span>{optionText(question, id)}</span>
              </button>
            ))}
          </div>
        </div>
      </>
    )
  } else if (state.phase === 'question') {
    body = (
      <>
        {scoreboard}
        <div className="arc-body">
          <p className="arc-kicker">QUIZMASTER · {who.name.toUpperCase()}{answerer ? ` · ${answerer.toUpperCase()}` : ''}</p>
          {questionBlock}
          {cur.answerShown ? (
            <>
              <p className="tv-answer" role="status"><small>ANSWER (quizmaster only)</small>{question.a}</p>
              <div className="round-actions">
                <button type="button" className="arc-btn" onClick={() => act((s, cfg) => award(s, cfg, seq, false))}>Incorrect</button>
                <button type="button" className="arc-btn arc-primary" onClick={() => act((s, cfg) => award(s, cfg, seq, true))}>Correct +{settings.points}</button>
              </div>
            </>
          ) : (
            <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => act((s, cfg) => revealAnswer(s, cfg, seq))}>Reveal answer (quizmaster)</button>
          )}
        </div>
      </>
    )
  } else {
    // reveal
    const order = state.optionOrders[cur.q]
    body = (
      <>
        {scoreboard}
        <div className="arc-body">
          <p className="arc-kicker">{who.name.toUpperCase()}{answerer ? ` · ${answerer.toUpperCase()}` : ''}</p>
          {questionBlock}
          <p className="tv-result" role="status">{cur.correct ? `Correct! +${settings.points}` : settings.format === 'host' ? 'Marked incorrect. No points.' : 'Not quite. No points.'}</p>
          {settings.format === 'choice' ? (
            <ul className="tv-options reveal" aria-label="Options">
              {order.map((id, pos) => (
                <li key={pos} className={`tv-option${id === 0 ? ' right' : ''}${id === cur.chosen ? ' picked' : ''}`}>
                  <b>{LETTERS[pos]}</b>
                  <span>{optionText(question, id)}</span>
                  <small>{id === 0 ? '✓ CORRECT' : ''}{id === cur.chosen ? (id === 0 ? ' · PICKED' : 'PICKED') : ''}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="tv-answer"><small>ANSWER</small>{question.a}</p>
          )}
          <p className="tv-explain">{question.explanation}</p>
          <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => act((s, cfg) => nextTurn(s, cfg, seq))}>Next</button>
        </div>
      </>
    )
  }

  const bar = state.phase === 'over' ? <GameBar title="Trivia Battle" backLabel="‹ ARCADE" onBack={onExit} /> : <GameBar title="Trivia Battle" backLabel="‹ MENU" onBack={() => setMenu('open')} />

  return (
    <div className="arc-game">
      <div className="arc-contents" inert={showMenu}>
        {bar}
        {warning ? <Notice>Progress can’t be saved on this device right now. Playing without saving.</Notice> : null}
        <div className="arc-play">{body}</div>
      </div>

      {showMenu ? (
        <div className="arc-overlay" role="dialog" aria-modal="true" aria-label="Game menu">
          {menu === 'open' ? (
            <>
              <p className="arc-lead">Paused</p>
              <p className="arc-text">Progress is saved on this device.</p>
              <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => setMenu('closed')}>Continue</button>
              <button type="button" className="arc-btn" onClick={onExit}>Leave to Arcade</button>
              <button type="button" className="arc-btn" onClick={() => setMenu('confirm')}>Abandon match…</button>
            </>
          ) : (
            <>
              <p className="arc-lead">Abandon this match?</p>
              <p className="arc-text">The saved match and scores will be deleted.</p>
              <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => setMenu('open')}>Keep playing</button>
              <button type="button" className="arc-btn" onClick={() => { void clear(); setMenu('closed'); onExit() }}>Delete and leave</button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
