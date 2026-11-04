import { useRef, useState } from 'react'
import { GameBar, Notice } from '../../shared/GameFrame'
import { useGameSave } from '../../shared/useGameSave'
import {
  BOARDS, GAME_VERSION, adjacentMines, minesLeft, newGame, parseSettings, parseState, reveal, toggleFlag,
  type Difficulty, type Random, type Result, type Settings, type State,
} from './rules'

const GAME_ID = 'minesweeper'

const browserRandom: Random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296

function parse(rawSettings: unknown, rawState: unknown): { settings: Settings; state: State } | null {
  const settings = parseSettings(rawSettings)
  const state = settings ? parseState(rawState, settings) : null
  return settings && state ? { settings, state } : null
}

interface Props {
  onExit: () => void
}

export default function MinesweeperScreen({ onExit }: Props) {
  const { loading, saved, warning, save, clear } = useGameSave<Settings, State>(GAME_ID, GAME_VERSION, parse)
  const [difficulty, setDifficulty] = useState<Difficulty>('starter')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [state, setState] = useState<State | null>(null)
  const [mode, setMode] = useState<'reveal' | 'flag'>('reveal')
  const [menu, setMenu] = useState<'closed' | 'open' | 'confirm'>('closed')
  const [confirmNew, setConfirmNew] = useState(false)
  const stateRef = useRef<State | null>(null)

  const begin = (s: Settings, st: State) => {
    stateRef.current = st
    setSettings(s)
    setState(st)
    setMode('reveal')
    setMenu('closed')
    void save(s, st, true)
  }

  const act = (fn: (s: State) => Result<State>) => {
    const current = stateRef.current
    if (!current || !settings) return
    const r = fn(current)
    if (!r.ok) return
    stateRef.current = r.state
    setState(r.state)
    if (r.state.status === 'won' || r.state.status === 'lost') void clear()
    else void save(settings, r.state)
  }

  const abandon = () => {
    void clear()
    setMenu('closed')
    onExit()
  }

  if (loading) {
    return (
      <div className="arc-game">
        <GameBar title="Minesweeper" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body arc-center"><p className="arc-text">Loading…</p></div>
      </div>
    )
  }

  if (!state || !settings) {
    return (
      <div className="arc-game">
        <GameBar title="Minesweeper" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body">
          {saved.kind === 'ok' ? (
            <div className="arc-card">
              <p className="arc-lead">Saved game</p>
              <p className="arc-text">{BOARDS[saved.settings.difficulty].label}</p>
              <button
                type="button"
                className="arc-btn arc-primary"
                onClick={() => {
                  stateRef.current = saved.state
                  setSettings(saved.settings)
                  setState(saved.state)
                }}
              >
                Resume game
              </button>
            </div>
          ) : null}
          {saved.kind === 'bad' ? <Notice>{saved.reason} Starting a new game replaces it.</Notice> : null}
          <p className="arc-text arc-rules">
            Reveal every safe square. A number counts the mines touching that square. Your first reveal is always safe.
            Use Flag mode to mark squares you think hide a mine.
          </p>
          <div className="arc-seg" role="group" aria-label="Board size">
            {(Object.keys(BOARDS) as Difficulty[]).map((d) => (
              <button key={d} type="button" aria-pressed={difficulty === d} className={difficulty === d ? 'selected' : ''} onClick={() => setDifficulty(d)}>
                {d === 'starter' ? 'Starter' : 'Harder'}
              </button>
            ))}
          </div>
          <p className="arc-text">{BOARDS[difficulty].label}</p>
          {confirmNew ? <Notice>This replaces your saved game.</Notice> : null}
          <button
            type="button"
            className="arc-btn arc-primary"
            onClick={() => {
              if (saved.kind === 'ok' && !confirmNew) {
                setConfirmNew(true)
                return
              }
              const s: Settings = { difficulty }
              begin(s, newGame(s))
            }}
          >
            {confirmNew ? 'Replace and start' : 'Start new game'}
          </button>
        </div>
      </div>
    )
  }

  const over = state.status === 'won' || state.status === 'lost'
  const cols = state.size

  return (
    <div className="arc-game">
      <div className="arc-contents" inert={menu !== 'closed'}>
      <GameBar title="Minesweeper" backLabel={over ? '‹ ARCADE' : '‹ MENU'} onBack={over ? onExit : () => setMenu('open')} />
      {warning ? <Notice>Progress can’t be saved on this device right now. Playing without saving.</Notice> : null}
      <div className="arc-play">
        <div className="ms-info">
          <span className="ms-count" aria-label="Mines left">
            Mines left: <strong>{minesLeft(state)}</strong>
          </span>
          <div className="arc-seg ms-mode" role="group" aria-label="Tap mode">
            <button type="button" aria-pressed={mode === 'reveal'} className={mode === 'reveal' ? 'selected' : ''} disabled={over} onClick={() => setMode('reveal')}>
              Reveal
            </button>
            <button type="button" aria-pressed={mode === 'flag'} className={mode === 'flag' ? 'selected' : ''} disabled={over} onClick={() => setMode('flag')}>
              Flag
            </button>
          </div>
        </div>

        <div className="ms-board" role="group" aria-label="Minefield" data-page-jump={cols} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {state.flagged.map((flag, i) => {
            const r = Math.floor(i / cols) + 1
            const c = (i % cols) + 1
            const open = state.revealed[i]
            const isMine = state.mines?.[i] === true
            const showMine = state.status === 'lost' && isMine
            const count = open && !isMine ? adjacentMines(state, i) : 0
            const label = showMine
              ? i === state.exploded ? 'mine, exploded' : 'mine'
              : open ? (count === 0 ? 'no adjacent mines' : `${count} adjacent mines`) : flag ? 'flagged' : 'hidden'
            const text = showMine ? '✱' : open ? (count === 0 ? '' : String(count)) : flag ? '⚑' : ''
            return (
              <button
                key={i}
                type="button"
                className={`ms-cell${open ? ' open' : ''}${i === state.exploded ? ' boom' : ''}`}
                aria-disabled={over || open ? true : undefined}
                aria-label={`Row ${r}, column ${c}, ${label}`}
                onClick={() => act((s) => (mode === 'flag' ? toggleFlag(s, i) : reveal(s, i, browserRandom)))}
              >
                {text}
              </button>
            )
          })}
        </div>

        <div className="arc-turn">
          <p className="arc-status" role="status" aria-live="polite">
            {state.status === 'won' ? 'You cleared the field!' : state.status === 'lost' ? 'Boom. You hit a mine.' : mode === 'flag' ? 'Flag mode: tap to mark' : 'Reveal mode: tap to dig'}
          </p>
          {over ? (
            <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => begin(settings, newGame(settings))}>
              Play again
            </button>
          ) : null}
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
              <button type="button" className="arc-btn" onClick={() => setMenu('confirm')}>Abandon game…</button>
            </>
          ) : (
            <>
              <p className="arc-lead">Abandon this game?</p>
              <p className="arc-text">The saved board will be deleted.</p>
              <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => setMenu('open')}>Keep playing</button>
              <button type="button" className="arc-btn" onClick={abandon}>Delete and leave</button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
