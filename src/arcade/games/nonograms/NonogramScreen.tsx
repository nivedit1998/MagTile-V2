import { useMemo, useRef, useState } from 'react'
import { NONOGRAM_PUZZLES } from '../../content/nonogramStarters'
import { GameBar, Notice } from '../../shared/GameFrame'
import { useGameSave } from '../../shared/useGameSave'
import { readPref, writePref } from '../../storage/saves'
import {
  GAME_VERSION, cluesFor, newGame, parseSettings, parseState, setCell, applyHint,
  type Mode, type Puzzle, type Result, type Settings, type State,
} from './rules'

const GAME_ID = 'nonograms'
const SOLVED_PREF = 'magtile.arcade.nonograms.solved'

const puzzleById = (id: string): Puzzle | undefined => NONOGRAM_PUZZLES.find((p) => p.id === id)

function parse(rawSettings: unknown, rawState: unknown): { settings: Settings; state: State } | null {
  const settings = parseSettings(rawSettings, NONOGRAM_PUZZLES)
  const puzzle = settings ? puzzleById(settings.puzzleId) : undefined
  const state = puzzle ? parseState(rawState, puzzle) : null
  return settings && state ? { settings, state } : null
}

function readSolved(): string[] {
  const raw = readPref<unknown>(SOLVED_PREF)
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
}

const MODE_LABEL: Record<Mode, string> = { fill: 'Fill', cross: 'Cross', clear: 'Clear' }

interface Props {
  onExit: () => void
}

export default function NonogramScreen({ onExit }: Props) {
  const { loading, saved, warning, save, clear } = useGameSave<Settings, State>(GAME_ID, GAME_VERSION, parse)
  const [solvedIds, setSolvedIds] = useState<string[]>(readSolved)
  const firstUnsolved = Math.max(0, NONOGRAM_PUZZLES.findIndex((p) => !solvedIds.includes(p.id)))
  const [pick, setPick] = useState<number | null>(null)
  const index = pick ?? firstUnsolved
  const [active, setActive] = useState<{ puzzle: Puzzle; state: State } | null>(null)
  const [mode, setMode] = useState<Mode>('fill')
  const [menu, setMenu] = useState<'closed' | 'open' | 'confirm'>('closed')
  const [confirmNew, setConfirmNew] = useState(false)
  const stateRef = useRef<State | null>(null)

  const clues = useMemo(() => (active ? cluesFor(active.puzzle.size, active.puzzle.solution) : null), [active])

  const begin = (puzzle: Puzzle, state: State, newSession: boolean) => {
    stateRef.current = state
    setActive({ puzzle, state })
    setMode('fill')
    setMenu('closed')
    void save({ puzzleId: puzzle.id }, state, newSession)
  }

  const act = (fn: (s: State, p: Puzzle) => Result<State>) => {
    const current = stateRef.current
    if (!current || !active) return
    const r = fn(current, active.puzzle)
    if (!r.ok) return
    stateRef.current = r.state
    setActive({ puzzle: active.puzzle, state: r.state })
    if (r.state.solved) {
      const next = Array.from(new Set([...readSolved(), active.puzzle.id]))
      writePref(SOLVED_PREF, next)
      setSolvedIds(next)
      void clear()
    } else {
      void save({ puzzleId: active.puzzle.id }, r.state)
    }
  }

  if (loading) {
    return (
      <div className="arc-game">
        <GameBar title="Nonograms" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body arc-center"><p className="arc-text">Loading…</p></div>
      </div>
    )
  }

  if (!active || !clues) {
    const puzzle = NONOGRAM_PUZZLES[index]
    const savedPuzzle = saved.kind === 'ok' ? puzzleById(saved.settings.puzzleId) : undefined
    return (
      <div className="arc-game">
        <GameBar title="Nonograms" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body">
          {saved.kind === 'ok' && savedPuzzle ? (
            <div className="arc-card">
              <p className="arc-lead">Saved puzzle</p>
              <p className="arc-text">{savedPuzzle.name} · {saved.state.hintsUsed} {saved.state.hintsUsed === 1 ? 'hint' : 'hints'} used</p>
              <button type="button" className="arc-btn arc-primary" onClick={() => { stateRef.current = saved.state; setActive({ puzzle: savedPuzzle, state: saved.state }) }}>
                Resume puzzle
              </button>
            </div>
          ) : null}
          {saved.kind === 'bad' ? <Notice>{saved.reason} Starting a puzzle replaces it.</Notice> : null}
          <p className="arc-text arc-rules">
            Numbers show runs of filled squares in each row and column. Fill the squares that match every clue.
            Use Cross to mark squares you know are empty. A hint fixes one square and is counted.
          </p>
          <div className="ng-pick">
            <button type="button" className="arc-btn" aria-label="Previous puzzle" onClick={() => setPick((index + NONOGRAM_PUZZLES.length - 1) % NONOGRAM_PUZZLES.length)}>‹</button>
            <p className="ng-pick-name">
              {puzzle.name}
              <span>Puzzle {index + 1} of {NONOGRAM_PUZZLES.length} · {puzzle.size} × {puzzle.size}{solvedIds.includes(puzzle.id) ? ' · solved' : ''}</span>
            </p>
            <button type="button" className="arc-btn" aria-label="Next puzzle" onClick={() => setPick((index + 1) % NONOGRAM_PUZZLES.length)}>›</button>
          </div>
          {confirmNew ? <Notice>This replaces your saved puzzle.</Notice> : null}
          <button
            type="button"
            className="arc-btn arc-primary"
            onClick={() => {
              if (saved.kind === 'ok' && !confirmNew) {
                setConfirmNew(true)
                return
              }
              begin(puzzle, newGame(puzzle), true)
            }}
          >
            {confirmNew ? 'Replace and start' : 'Start puzzle'}
          </button>
        </div>
      </div>
    )
  }

  const { puzzle, state } = active
  const n = puzzle.size
  const nextPuzzle = () => {
    const i = NONOGRAM_PUZZLES.findIndex((p) => p.id === puzzle.id)
    const next = NONOGRAM_PUZZLES[(i + 1) % NONOGRAM_PUZZLES.length]
    begin(next, newGame(next), true)
  }

  return (
    <div className="arc-game">
      <div className="arc-contents" inert={menu !== 'closed'}>
      <GameBar title={puzzle.name} backLabel={state.solved ? '‹ ARCADE' : '‹ MENU'} onBack={state.solved ? onExit : () => setMenu('open')} />
      {warning ? <Notice>Progress can’t be saved on this device right now. Playing without saving.</Notice> : null}
      <div className="arc-play">
        <div className="ng-board" style={{ gridTemplateColumns: `calc(96 * var(--u)) repeat(${n}, minmax(0, 1fr))`, gridTemplateRows: `calc(84 * var(--u)) repeat(${n}, minmax(0, 1fr))` }}>
          <span className="ng-corner" aria-hidden="true" />
          {clues.cols.map((c, i) => (
            <span key={`c${i}`} className="ng-clue ng-col" aria-label={`Column ${i + 1} clue ${c.join(' ')}`}>
              {c.map((v, k) => <span key={k}>{v}</span>)}
            </span>
          ))}
          {clues.rows.map((r, row) => (
            <FragmentRow key={row} row={row} n={n} clue={r} state={state} disabled={state.solved} onCell={(i) => act((s, p) => setCell(s, p, i, mode))} />
          ))}
        </div>

        <div className="ng-tools">
          <div className="arc-seg" role="group" aria-label="Tap mode">
            {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? 'selected' : ''} disabled={state.solved} onClick={() => setMode(m)}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
          <button type="button" className="arc-btn" disabled={state.solved} onClick={() => act((s, p) => applyHint(s, p))}>
            Hint ({state.hintsUsed})
          </button>
        </div>

        <div className="arc-turn">
          <p className="arc-status" role="status" aria-live="polite">
            {state.solved
              ? `Solved! ${state.hintsUsed === 0 ? 'No hints used.' : `${state.hintsUsed} ${state.hintsUsed === 1 ? 'hint' : 'hints'} used.`}`
              : `${MODE_LABEL[mode]} mode`}
          </p>
          {state.solved ? (
            <button type="button" className="arc-btn arc-primary" autoFocus onClick={nextPuzzle}>
              Next puzzle
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
              <button type="button" className="arc-btn" onClick={() => setMenu('confirm')}>Restart puzzle…</button>
            </>
          ) : (
            <>
              <p className="arc-lead">Restart this puzzle?</p>
              <p className="arc-text">Your marks and hint count are cleared.</p>
              <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => setMenu('open')}>Keep playing</button>
              <button type="button" className="arc-btn" onClick={() => begin(puzzle, newGame(puzzle), true)}>Restart</button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

interface RowProps {
  row: number
  n: number
  clue: number[]
  state: State
  disabled: boolean
  onCell: (i: number) => void
}

/** One puzzle row: its clue followed by its cells (rendered inline in the parent grid). */
function FragmentRow({ row, n, clue, state, disabled, onCell }: RowProps) {
  return (
    <>
      <span className="ng-clue ng-row" aria-label={`Row ${row + 1} clue ${clue.join(' ')}`}>
        {clue.map((v, k) => <span key={k}>{v}</span>)}
      </span>
      {Array.from({ length: n }, (_, col) => {
        const i = row * n + col
        const mark = state.cells[i]
        return (
          <button
            key={i}
            type="button"
            className={`ng-cell${mark === 1 ? ' fill' : ''}${state.hinted[i] ? ' hint' : ''}`}
            aria-disabled={disabled || state.hinted[i] ? true : undefined}
            aria-label={`Row ${row + 1}, column ${col + 1}, ${mark === 1 ? 'filled' : mark === 2 ? 'crossed' : 'empty'}${state.hinted[i] ? ', hint' : ''}`}
            onClick={() => onCell(i)}
          >
            {mark === 2 ? '×' : ''}
          </button>
        )
      })}
    </>
  )
}
