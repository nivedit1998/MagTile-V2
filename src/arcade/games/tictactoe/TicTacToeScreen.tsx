import { useEffect, useRef, useState } from 'react'
import { GameBar, Notice } from '../../shared/GameFrame'
import { readPref, readSave, removeSave, writePref, writeSave, type ReadResult } from '../../storage/saves'
import {
  GAME_VERSION, MARKS, MATCH_LENGTHS, MAX_NAME_LENGTH, matchWinner, newMatch, nextRound, parseSettings,
  parseState, place, replayStarter, validateNames,
  type MatchLength, type Player, type Result, type Settings, type State,
} from './rules'

const GAME_ID = 'tictactoe'
const NAMES_PREF = 'magtile.arcade.tictactoe.names'
const LENGTH_LABEL: Record<MatchLength, string> = { 1: 'Single game', 3: 'Best of 3', 5: 'Best of 5' }

type View = 'loading' | 'setup' | 'play' | 'results'
type Saved =
  | { kind: 'none' }
  | { kind: 'ok'; settings: Settings; state: State }
  | { kind: 'bad'; reason: string }

interface Props {
  onExit: () => void
}

function interpret(read: ReadResult): Saved {
  if (read.kind === 'none') return { kind: 'none' }
  if (read.kind === 'bad') return { kind: 'bad', reason: read.reason }
  const settings = parseSettings(read.envelope.settings)
  const state = settings ? parseState(read.envelope.state, settings) : null
  return settings && state ? { kind: 'ok', settings, state } : { kind: 'bad', reason: 'The saved match is damaged.' }
}

export default function TicTacToeScreen({ onExit }: Props) {
  const [view, setView] = useState<View>('loading')
  const [saved, setSaved] = useState<Saved>({ kind: 'none' })
  const [nameA, setNameA] = useState('')
  const [nameB, setNameB] = useState('')
  const [rounds, setRounds] = useState<MatchLength>(3)
  const [errors, setErrors] = useState<[string | null, string | null]>([null, null])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [state, setState] = useState<State | null>(null)
  const [menu, setMenu] = useState<'closed' | 'open' | 'confirm'>('closed')
  const [confirmNew, setConfirmNew] = useState(false)
  const [saveWarning, setSaveWarning] = useState(false)
  const stateRef = useRef<State | null>(null)
  const sessionRef = useRef('')

  // Load any saved match and the last-used names.
  useEffect(() => {
    let live = true
    const prefs = readPref<unknown>(NAMES_PREF)
    if (Array.isArray(prefs) && typeof prefs[0] === 'string' && typeof prefs[1] === 'string') {
      setNameA(prefs[0].slice(0, MAX_NAME_LENGTH))
      setNameB(prefs[1].slice(0, MAX_NAME_LENGTH))
    }
    readSave(GAME_ID, GAME_VERSION).then((read) => {
      if (!live) return
      const result = interpret(read)
      setSaved(result)
      if (result.kind === 'ok') {
        setRounds(result.settings.rounds)
        setNameA(result.settings.names[0])
        setNameB(result.settings.names[1])
      }
      setView('setup')
    })
    return () => {
      live = false
    }
  }, [])

  const persist = async (s: Settings, st: State) => {
    const ok = await writeSave({
      schemaVersion: 1,
      gameId: GAME_ID,
      gameVersion: GAME_VERSION,
      sessionId: sessionRef.current,
      updatedAt: Date.now(),
      settings: s,
      state: st,
    })
    setSaveWarning(!ok)
  }

  const begin = (s: Settings, st: State, newSession: boolean) => {
    if (newSession || !sessionRef.current) sessionRef.current = crypto.randomUUID()
    stateRef.current = st
    setSettings(s)
    setState(st)
    setMenu('closed')
    setView('play')
    void persist(s, st)
  }

  const start = () => {
    const check = validateNames(nameA, nameB)
    setErrors(check.errors)
    if (!check.ok) return
    if (saved.kind === 'ok' && !confirmNew) {
      setConfirmNew(true)
      return
    }
    writePref(NAMES_PREF, check.names)
    setNameA(check.names[0])
    setNameB(check.names[1])
    begin({ names: check.names, rounds }, newMatch(0), true)
  }

  const resume = () => {
    if (saved.kind !== 'ok') return
    sessionRef.current = sessionRef.current || crypto.randomUUID()
    stateRef.current = saved.state
    setSettings(saved.settings)
    setState(saved.state)
    if (saved.state.matchOver) {
      void removeSave(GAME_ID)
      setSaved({ kind: 'none' })
      setView('results')
    } else {
      setView('play')
    }
  }

  // Always applies against the latest state, so a double tap cannot apply twice.
  const act = (fn: (s: State) => Result<State>) => {
    const current = stateRef.current
    if (!current || !settings) return
    const r = fn(current)
    if (!r.ok) return
    stateRef.current = r.state
    setState(r.state)
    void persist(settings, r.state)
  }

  const showResults = () => {
    void removeSave(GAME_ID)
    setSaved({ kind: 'none' })
    setView('results')
  }

  const replay = () => {
    if (!settings || !state) return
    begin(settings, newMatch(replayStarter(state)), true)
  }

  const abandon = () => {
    void removeSave(GAME_ID)
    setSaved({ kind: 'none' })
    setMenu('closed')
    onExit()
  }

  // ---- Views ----------------------------------------------------------------

  if (view === 'loading') {
    return (
      <div className="arc-game">
        <GameBar title="Tic-Tac-Toe" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body arc-center"><p className="arc-text">Loading…</p></div>
      </div>
    )
  }

  if (view === 'setup') {
    return (
      <div className="arc-game">
        <GameBar title="Tic-Tac-Toe" backLabel="‹ ARCADE" onBack={onExit} />
        <form
          className="arc-body"
          onSubmit={(e) => {
            e.preventDefault()
            start()
          }}
          noValidate
        >
          {saved.kind === 'ok' ? (
            <div className="arc-card">
              <p className="arc-lead">Saved match</p>
              <p className="arc-text">
                {saved.settings.names[0]} vs {saved.settings.names[1]} · {LENGTH_LABEL[saved.settings.rounds]} ·
                round {saved.state.roundIndex + 1} · {saved.state.scores[0]}–{saved.state.scores[1]}
              </p>
              <button type="button" className="arc-btn arc-primary" onClick={resume}>Resume match</button>
            </div>
          ) : null}
          {saved.kind === 'bad' ? (
            <Notice>{saved.reason} Starting a new game replaces it.</Notice>
          ) : null}

          <p className="arc-text arc-rules">
            Two players take turns. Three in a row wins the round. A full board is a draw.
            The player who starts alternates each round.
          </p>

          <label className="arc-field">
            <span>Player 1 · {MARKS[0]}</span>
            <input
              value={nameA}
              maxLength={MAX_NAME_LENGTH}
              autoComplete="off"
              onChange={(e) => setNameA(e.target.value)}
              aria-invalid={errors[0] !== null}
              aria-describedby={errors[0] ? 'ttt-err-a' : undefined}
            />
            {errors[0] ? <em id="ttt-err-a">{errors[0]}</em> : null}
          </label>
          <label className="arc-field">
            <span>Player 2 · {MARKS[1]}</span>
            <input
              value={nameB}
              maxLength={MAX_NAME_LENGTH}
              autoComplete="off"
              onChange={(e) => setNameB(e.target.value)}
              aria-invalid={errors[1] !== null}
              aria-describedby={errors[1] ? 'ttt-err-b' : undefined}
            />
            {errors[1] ? <em id="ttt-err-b">{errors[1]}</em> : null}
          </label>

          <div className="arc-seg" role="group" aria-label="Match length">
            {MATCH_LENGTHS.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={rounds === n}
                className={rounds === n ? 'selected' : ''}
                onClick={() => setRounds(n)}
              >
                {LENGTH_LABEL[n]}
              </button>
            ))}
          </div>

          {confirmNew ? <Notice>This replaces your saved match.</Notice> : null}
          <button type="submit" className="arc-btn arc-primary">{confirmNew ? 'Replace and start' : 'Start new game'}</button>
        </form>
      </div>
    )
  }

  if (!settings || !state) return null

  if (view === 'results') {
    const w = matchWinner(state)
    return (
      <div className="arc-game">
        <GameBar title="Result" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body arc-center">
          <p className="arc-kicker">{LENGTH_LABEL[settings.rounds].toUpperCase()} · MATCH OVER</p>
          <p className="arc-big" role="status">{w === null ? 'Match tied' : `${settings.names[w]} wins`}</p>
          <table className="arc-table">
            <tbody>
              {([0, 1] as const).map((p) => (
                <tr key={p}>
                  <th scope="row">{MARKS[p]} · {settings.names[p]}</th>
                  <td>{state.scores[p]} {state.scores[p] === 1 ? 'win' : 'wins'}</td>
                </tr>
              ))}
              <tr><th scope="row">Draws</th><td>{state.draws}</td></tr>
              <tr><th scope="row">Rounds played</th><td>{state.scores[0] + state.scores[1] + state.draws}</td></tr>
            </tbody>
          </table>
          <button type="button" className="arc-btn arc-primary" onClick={replay} autoFocus>
            Replay · {settings.names[replayStarter(state)]} starts
          </button>
          <button type="button" className="arc-btn" onClick={onExit}>Back to Arcade</button>
        </div>
      </div>
    )
  }

  // ---- Play -----------------------------------------------------------------

  const roundOver = state.roundStatus !== 'playing'
  const shownTurn: Player = state.turn
  const status = (() => {
    if (state.roundStatus === 'won' && state.winner !== null) return `${settings.names[state.winner]} wins round ${state.roundIndex + 1}`
    if (state.roundStatus === 'draw') return `Round ${state.roundIndex + 1} is a draw`
    return `${MARKS[state.turn]} · ${settings.names[state.turn]} to move`
  })()

  return (
    <div className="arc-game">
      <div className="arc-contents" inert={menu !== 'closed'}>
      <GameBar title="Tic-Tac-Toe" backLabel="‹ MENU" onBack={() => setMenu('open')} />
      {saveWarning ? <Notice>Progress can’t be saved on this device right now. Playing without saving.</Notice> : null}
      <div className="arc-play">
        <div className="arc-score" aria-label="Scores">
          {([0, 1] as const).map((p) => (
            <div key={p} className={`arc-score-row${!roundOver && state.turn === p ? ' on-turn' : ''}`}>
              <span className="arc-mark">{MARKS[p]}</span>
              <span className="arc-name">{settings.names[p]}</span>
              <span className="arc-wins">{state.scores[p]}</span>
            </div>
          ))}
          <p className="arc-meta">
            {LENGTH_LABEL[settings.rounds]} · Round {state.roundIndex + 1}
            {state.draws > 0 ? ` · ${state.draws} ${state.draws === 1 ? 'draw' : 'draws'}` : ''}
          </p>
        </div>

        <div className="arc-turn">
          <p className="arc-status" role="status" aria-live="polite">{status}</p>
          {roundOver ? (
            <button
              type="button"
              className="arc-btn arc-primary"
              autoFocus
              onClick={() => (state.matchOver ? showResults() : act(nextRound))}
            >
              {state.matchOver ? 'See result' : 'Next round'}
            </button>
          ) : null}
        </div>

        <div className="ttt-board" role="group" aria-label="Board">
          {state.board.map((cell, i) => {
            const win = state.line?.includes(i) ?? false
            const row = Math.floor(i / 3) + 1
            const col = (i % 3) + 1
            return (
              <button
                key={i}
                type="button"
                className={`ttt-cell${win ? ' win' : ''}`}
                aria-disabled={cell !== null || roundOver ? true : undefined}
                aria-label={`Row ${row}, column ${col}, ${cell === null ? 'empty' : MARKS[cell]}${win ? ', winning line' : ''}`}
                onClick={() => act((s) => place(s, settings, shownTurn, i))}
              >
                {cell === null ? '' : MARKS[cell]}
              </button>
            )
          })}
        </div>
      </div>
      </div>

      {menu !== 'closed' ? (
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
              <p className="arc-text">The saved match and its scores will be deleted.</p>
              <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => setMenu('open')}>Keep playing</button>
              <button type="button" className="arc-btn" onClick={abandon}>Delete and leave</button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
