import { useRef, useState } from 'react'
import type { Random } from '../../shared/deck'
import { GameBar, Notice } from '../../shared/GameFrame'
import { PrivateCover } from '../../shared/PrivateCover'
import { useGameSave } from '../../shared/useGameSave'
import { usePrivacy } from '../../shared/usePrivacy'
import {
  COLUMN_LABELS, FLEET, GAME_VERSION, SIZE, cellIndex, cellName, cellsFor, endTurn, fire, lockFleet, newMatch, ownView, parseSettings, parseState,
  placeShip, randomFleet, sunkByPlayer, targetView, type Fleet, type Orientation, type Result, type Settings, type Ship, type State,
} from './rules'

const GAME_ID = 'battleships'
const browserRandom: Random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296
const SHIP_NAME = Object.fromEntries(FLEET.map((f) => [f.id, f.name])) as Record<string, string>

function parse(rawSettings: unknown, rawState: unknown): { settings: Settings; state: State } | null {
  const settings = parseSettings(rawSettings)
  const state = settings ? parseState(rawState) : null
  return settings && state ? { settings, state } : null
}

interface Mark {
  glyph: string
  cls: string
}

/** Display-only 10 x 10 overview. It is deliberately not made of 100 touch targets; cells are chosen with the large pickers. */
function Board({ marks, selected, label }: { marks: Mark[]; selected: number | null; label: string }) {
  return (
    <div className="bs-grid" role="img" aria-label={label}>
      <span className="bs-head" />
      {COLUMN_LABELS.map((c) => <span key={c} className="bs-head">{c}</span>)}
      {Array.from({ length: SIZE }, (_, r) => (
        <div className="bs-row" key={r}>
          <span className="bs-head">{r + 1}</span>
          {Array.from({ length: SIZE }, (_, c) => {
            const i = cellIndex(r, c)
            return <span key={c} className={`bs-cell ${marks[i].cls}${selected === i ? ' sel' : ''}`}>{marks[i].glyph}</span>
          })}
        </div>
      ))}
    </div>
  )
}

/** Large column (A-J) and row (1-10) pickers: two rows of five buttons each. */
function Picker({ col, row, onCol, onRow }: { col: number; row: number; onCol: (c: number) => void; onRow: (r: number) => void }) {
  return (
    <div className="bs-pick">
      <div className="arc-seg arc-wrap5" role="group" aria-label="Column" data-page-jump={5}>
        {COLUMN_LABELS.map((l, c) => (
          <button key={l} type="button" aria-pressed={col === c} className={col === c ? 'selected' : ''} aria-label={`Column ${l}`} onClick={() => onCol(c)}>{l}</button>
        ))}
      </div>
      <div className="arc-seg arc-wrap5" role="group" aria-label="Row" data-page-jump={5}>
        {Array.from({ length: SIZE }, (_, r) => (
          <button key={r} type="button" aria-pressed={row === r} className={row === r ? 'selected' : ''} aria-label={`Row ${r + 1}`} onClick={() => onRow(r)}>{r + 1}</button>
        ))}
      </div>
    </div>
  )
}

interface Props {
  onExit: () => void
}

export default function BattleshipsScreen({ onExit }: Props) {
  const { loading, saved, warning, save, clear } = useGameSave<Settings, State>(GAME_ID, GAME_VERSION, parse)

  const names: [string, string] = ['Player 1', 'Player 2']
  const [confirmNew, setConfirmNew] = useState(false)

  const [settings, setSettings] = useState<Settings | null>(null)
  const [state, setState] = useState<State | null>(null)
  const [menu, setMenu] = useState<'closed' | 'open' | 'confirm'>('closed')
  const stateRef = useRef<State | null>(null)

  // Placement (kept in the screen until the fleet is locked) and aiming selections.
  const [placed, setPlaced] = useState<Ship[]>([])
  const [orientation, setOrientation] = useState<Orientation>('h')
  const [col, setCol] = useState(0)
  const [row, setRow] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [view, setView] = useState<'shots' | 'fleet'>('shots')

  const turnIndex = state ? state.shots[0].length + state.shots[1].length - (state.phase === 'result' || state.phase === 'over' ? 1 : 0) : 0
  const secretKey = !state ? null : state.phase === 'place' ? `bs-place-${state.placing}` : state.phase === 'aim' || state.phase === 'result' ? `bs-turn-${turnIndex}` : null
  const privacy = usePrivacy(secretKey)

  const commit = (next: State, s: Settings) => {
    stateRef.current = next
    setState(next)
    if (next.phase === 'over') void clear()
    else void save(s, next)
  }
  const act = (fn: (s: State) => Result<State>) => {
    const cur = stateRef.current
    if (!cur || !settings) return
    const r = fn(cur)
    if (!r.ok) return
    commit(r.state, settings)
  }
  const begin = (s: Settings) => {
    const st = newMatch()
    stateRef.current = st
    setSettings(s)
    setState(st)
    setMenu('closed')
    setPlaced([])
    setMessage(null)
    setView('shots')
    void save(s, st, true)
  }

  if (loading) {
    return (
      <div className="arc-game">
        <GameBar title="Battleships" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body arc-center"><p className="arc-text">Loading…</p></div>
      </div>
    )
  }

  // ---- Setup -----------------------------------------------------------------
  if (!state || !settings) {
    const startNew = () => {
      if (saved.kind === 'ok' && !confirmNew) {
        setConfirmNew(true)
        return
      }
      begin({ names })
    }
    return (
      <div className="arc-game">
        <GameBar title="Battleships" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body">
          {saved.kind === 'ok' ? (
            <div className="arc-card">
              <p className="arc-lead">Saved game</p>
              <p className="arc-text">{saved.settings.names.join(' vs ')} · {saved.state.phase === 'place' ? 'placing fleets' : `${saved.state.shots[0].length + saved.state.shots[1].length} shots fired`}</p>
              <button type="button" className="arc-btn arc-primary" onClick={() => { stateRef.current = saved.state; setSettings(saved.settings); setState(saved.state); setPlaced([]) }}>Resume game (covered)</button>
            </div>
          ) : null}
          {saved.kind === 'bad' ? <Notice>{saved.reason} Starting a new game replaces it.</Notice> : null}

          <p className="arc-lead">Battleships</p>
          <p className="arc-text arc-rules">Each player secretly places 5 ships on a 10 × 10 grid, then you take turns firing one shot. Sink all five enemy ships to win. Fleets are placed behind a cover.</p>
          <div className="arc-spacer" />
          {confirmNew ? <Notice>This replaces your saved game.</Notice> : null}
          <button type="button" className="arc-btn arc-primary" onClick={startNew}>{confirmNew ? 'Replace and start' : 'Start game'}</button>
        </div>
      </div>
    )
  }

  // ---- Play ------------------------------------------------------------------
  const nm = settings.names
  const seq = state.seq
  const showMenu = menu !== 'closed'
  const selectedCell = cellIndex(row, col)

  let body: React.ReactNode
  if (state.phase === 'place') {
    const p = state.placing
    if (privacy.covered) {
      body = <PrivateCover kicker={`FLEET ${p + 1} OF 2`} title={`Pass to ${nm[p]}`} text={`Only ${nm[p]} should look. Place your fleet in private; the other player looks away.`} button={`I’m ${nm[p]}. Place my fleet`} onReveal={privacy.reveal} />
    } else {
      const done = placed.length === FLEET.length
      const def = done ? null : FLEET[placed.length]
      const preview = def ? cellsFor(def.len, orientation, row, col) : null
      const taken = new Set(placed.flatMap((s) => s.cells))
      const marks: Mark[] = Array.from({ length: SIZE * SIZE }, (_, i) =>
        taken.has(i) ? { glyph: '■', cls: 'ship' } : preview && preview.includes(i) ? { glyph: '□', cls: preview.some((c) => taken.has(c)) ? 'bad' : 'preview' } : { glyph: '', cls: 'water' },
      )
      body = (
        <div className="arc-body">
          <p className="arc-kicker">{nm[p].toUpperCase()} · PLACE FLEET ({placed.length}/{FLEET.length})</p>
          <Board marks={marks} selected={null} label={`Your fleet: ${placed.length} of 5 ships placed`} />
          {def ? (
            <>
              <p className="bs-line"><strong>{def.name}</strong> · length {def.len} · top-left at <strong>{cellName(selectedCell)}</strong></p>
              <div className="arc-seg" role="group" aria-label="Orientation">
                <button type="button" aria-pressed={orientation === 'h'} className={orientation === 'h' ? 'selected' : ''} onClick={() => setOrientation('h')}>Horizontal</button>
                <button type="button" aria-pressed={orientation === 'v'} className={orientation === 'v' ? 'selected' : ''} onClick={() => setOrientation('v')}>Vertical</button>
              </div>
              <Picker col={col} row={row} onCol={setCol} onRow={setRow} />
              {message ? <p className="arc-notice" role="alert">{message}</p> : null}
              <button
                type="button"
                className="arc-btn arc-primary"
                onClick={() => {
                  const r = placeShip(placed, orientation, row, col)
                  if (!r.ok) {
                    setMessage(r.reason === 'overlap' ? 'That would overlap another ship.' : 'That ship would leave the grid.')
                    return
                  }
                  setMessage(null)
                  setPlaced([...placed, r.ship])
                }}
              >
                Place {def.name}
              </button>
            </>
          ) : (
            <>
              <p className="bs-line">All five ships are placed. Check the grid, then lock your fleet.</p>
              <button
                type="button"
                className="arc-btn arc-primary"
                onClick={() => {
                  const fleet: Fleet = placed
                  privacy.hide()
                  setPlaced([])
                  act((s) => lockFleet(s, seq, fleet))
                }}
              >
                Lock fleet and hide
              </button>
            </>
          )}
          <div className="bs-actions">
            <button type="button" className="arc-btn" disabled={placed.length === 0} onClick={() => { setPlaced(placed.slice(0, -1)); setMessage(null) }}>Undo last</button>
            <button type="button" className="arc-btn" onClick={() => { setPlaced(randomFleet(browserRandom)); setMessage(null) }}>Random fleet</button>
          </div>
        </div>
      )
    }
  } else if (state.phase === 'aim' || state.phase === 'result') {
    const p = state.turn
    if (privacy.covered) {
      body = <PrivateCover kicker={`TURN ${turnIndex + 1}`} title={`Pass to ${nm[p]}`} text={`Only ${nm[p]} should look. Your fleet and shots are shown once you tap.`} button={`I’m ${nm[p]}. Show my turn`} onReveal={privacy.reveal} />
    } else {
      const tv = targetView(state, p)
      const ov = ownView(state, p)
      const showShots = view === 'shots'
      const marks: Mark[] = showShots
        ? tv.map((c) => (c === 'unknown' ? { glyph: '', cls: 'water' } : c === 'miss' ? { glyph: '·', cls: 'miss' } : c === 'hit' ? { glyph: '✕', cls: 'hit' } : { glyph: '✕', cls: 'sunk' }))
        : ov.map((c) => (c === 'water' ? { glyph: '', cls: 'water' } : c === 'ship' ? { glyph: '■', cls: 'ship' } : c === 'hit' ? { glyph: '✕', cls: 'hit' } : { glyph: '·', cls: 'miss' }))
      const already = state.shots[p].includes(selectedCell)
      const last = state.last
      body = (
        <div className="arc-body">
          <p className="arc-kicker">{nm[p].toUpperCase()} · {state.phase === 'aim' ? 'YOUR SHOT' : 'RESULT'}</p>
          <div className="arc-seg" role="group" aria-label="Board">
            <button type="button" aria-pressed={showShots} className={showShots ? 'selected' : ''} onClick={() => setView('shots')}>My shots</button>
            <button type="button" aria-pressed={!showShots} className={!showShots ? 'selected' : ''} onClick={() => setView('fleet')}>My fleet</button>
          </div>
          <Board marks={marks} selected={state.phase === 'aim' && showShots ? selectedCell : last ? last.cell : null} label={showShots ? `Your shots: ${state.shots[p].length} fired, ${sunkByPlayer(state, p).length} ships sunk` : 'Your fleet with the enemy shots on it'} />
          {state.phase === 'aim' ? (
            <>
              <Picker col={col} row={row} onCol={setCol} onRow={setRow} />
              <button type="button" className="arc-btn arc-primary" disabled={already} onClick={() => act((s) => fire(s, seq, selectedCell))}>
                {already ? `Already fired at ${cellName(selectedCell)}` : `Fire at ${cellName(selectedCell)}`}
              </button>
            </>
          ) : last ? (
            <>
              <p className="tv-result" role="status">
                {last.result === 'miss' ? `${cellName(last.cell)}: Miss.` : last.result === 'hit' ? `${cellName(last.cell)}: Hit!` : `${cellName(last.cell)}: You sank their ${SHIP_NAME[last.sunk!]}!`}
              </p>
              <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => { privacy.hide(); setView('shots'); act((s) => endTurn(s, seq)) }}>End turn and hide</button>
            </>
          ) : null}
        </div>
      )
    }
  } else {
    const w = state.winner!
    body = (
      <div className="arc-body">
        <p className="arc-kicker">GAME OVER</p>
        <p className="arc-big" role="status">{nm[w]} wins</p>
        <p className="arc-text">{state.last ? `The last shot at ${cellName(state.last.cell)} sank the ${SHIP_NAME[state.last.sunk ?? '']}. ` : ''}Shots fired: {nm[0]} {state.shots[0].length}, {nm[1]} {state.shots[1].length}.</p>
        <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => begin(settings)}>Play again</button>
        <button type="button" className="arc-btn" onClick={onExit}>Back to Arcade</button>
      </div>
    )
  }

  return (
    <div className="arc-game">
      <div className="arc-contents" inert={showMenu}>
        <GameBar title="Battleships" backLabel={state.phase === 'over' ? '‹ ARCADE' : '‹ MENU'} onBack={state.phase === 'over' ? onExit : () => setMenu('open')} />
        {warning ? <Notice>Progress can’t be saved on this device right now. Playing without saving.</Notice> : null}
        <div className="arc-play">{body}</div>
      </div>

      {showMenu ? (
        <div className="arc-overlay" role="dialog" aria-modal="true" aria-label="Game menu">
          {menu === 'open' ? (
            <>
              <p className="arc-lead">Paused</p>
              <p className="arc-text">Progress is saved on this device. Boards stay covered until the right player taps.</p>
              <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => setMenu('closed')}>Continue</button>
              <button type="button" className="arc-btn" onClick={onExit}>Leave to Arcade</button>
              <button type="button" className="arc-btn" onClick={() => setMenu('confirm')}>Abandon game…</button>
            </>
          ) : (
            <>
              <p className="arc-lead">Abandon this game?</p>
              <p className="arc-text">The saved game will be deleted.</p>
              <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => setMenu('open')}>Keep playing</button>
              <button type="button" className="arc-btn" onClick={() => { void clear(); setMenu('closed'); onExit() }}>Delete and leave</button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
