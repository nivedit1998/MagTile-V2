import { useRef, useState } from 'react'
import { WORD_PAIRS } from '../../content/pairs'
import type { Random } from '../../shared/deck'
import { GameBar, Notice } from '../../shared/GameFrame'
import { BallotView, PrivateCover, TallyList } from '../../shared/PrivateCover'
import { usePrivacy } from '../../shared/usePrivacy'
import { useGameSave } from '../../shared/useGameSave'
import {
  GAME_VERSION, MAX_PLAYERS, MIN_PLAYERS, acknowledgeWord, aliveIndexes, continueGame, defaultUndercover, discussionOrder, maxUndercover,
  newGame, parseSettings, parseState, startRunoff, startVote, validateSetup, vote, wordFor,
  type Result, type Settings, type State,
} from './rules'

const GAME_ID = 'undercover'
const browserRandom: Random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296

function parse(rawSettings: unknown, rawState: unknown): { settings: Settings; state: State } | null {
  const settings = parseSettings(rawSettings)
  const state = settings ? parseState(rawState, settings) : null
  return settings && state ? { settings, state } : null
}

const roleLabel = (r: string) => (r === 'undercover' ? 'Undercover' : 'Civilian')

interface Props {
  onExit: () => void
}

export default function UndercoverScreen({ onExit }: Props) {
  const { loading, saved, warning, save, clear } = useGameSave<Settings, State>(GAME_ID, GAME_VERSION, parse)

  const [names, setNames] = useState<string[]>(['Player 1', 'Player 2', 'Player 3', 'Player 4'])
  const [undercover, setUndercover] = useState(1)
  const [setupNote, setSetupNote] = useState<string | null>(null)
  const [confirmNew, setConfirmNew] = useState(false)

  const [settings, setSettings] = useState<Settings | null>(null)
  const [state, setState] = useState<State | null>(null)
  const [menu, setMenu] = useState<'closed' | 'open' | 'confirm'>('closed')
  const stateRef = useRef<State | null>(null)

  // Secret step on screen: a player's word reveal. Votes manage their own cover (BallotView).
  const secretKey = state && settings && state.phase === 'reveal' ? `uc-word-${state.revealIndex}` : null
  const privacy = usePrivacy(secretKey)

  const commit = (next: State, s: Settings) => {
    stateRef.current = next
    setState(next)
    if (next.phase === 'over') void clear()
    else void save(s, next)
  }

  const begin = (s: Settings) => {
    const pair = WORD_PAIRS[Math.min(WORD_PAIRS.length - 1, Math.floor(browserRandom() * WORD_PAIRS.length))]
    const st = newGame(s, [pair[0], pair[1]], browserRandom)
    stateRef.current = st
    setSettings(s)
    setState(st)
    setMenu('closed')
    void save(s, st, true)
  }

  const act = (fn: (s: State) => Result<State>) => {
    const cur = stateRef.current
    if (!cur || !settings) return
    const r = fn(cur)
    if (!r.ok) return
    commit(r.state, settings)
  }

  if (loading) {
    return (
      <div className="arc-game">
        <GameBar title="Undercover" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body arc-center"><p className="arc-text">Loading…</p></div>
      </div>
    )
  }

  // ---- Setup -----------------------------------------------------------------
  if (!state || !settings) {
    const max = maxUndercover(names.length)
    const effective = Math.min(undercover, max)
    const startNew = () => {
      const check = validateSetup(names, effective)
      setSetupNote(check.undercoverError)
      if (!check.ok) return
      if (saved.kind === 'ok' && !confirmNew) {
        setConfirmNew(true)
        return
      }
      begin({ names: check.names, undercover: effective })
    }
    return (
      <div className="arc-game">
        <GameBar title="Undercover" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body">
          {saved.kind === 'ok' ? (
            <div className="arc-card">
              <p className="arc-lead">Saved game</p>
              <p className="arc-text">{saved.settings.names.length} players · round {saved.state.round} · {saved.state.alive.filter(Boolean).length} still in</p>
              <button type="button" className="arc-btn arc-primary" onClick={() => { stateRef.current = saved.state; setSettings(saved.settings); setState(saved.state) }}>Resume game (covered)</button>
            </div>
          ) : null}
          {saved.kind === 'bad' ? <Notice>{saved.reason} Starting a new game replaces it.</Notice> : null}

          <p className="arc-lead">Undercover</p>
          <p className="arc-text arc-rules">Civilians share one secret word; undercover players get a similar one. Describe it, then vote someone out. Each person sees their word alone, behind a cover.</p>
          <div className="arc-field"><span>Players</span></div>

          <div className="arc-seg arc-wrap" role="group" aria-label="Number of players">
            {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={names.length === n}
                className={names.length === n ? 'selected' : ''}
                onClick={() => {
                  setNames((cur) => Array.from({ length: n }, (_, i) => cur[i] ?? `Player ${i + 1}`))
                  setUndercover((u) => Math.min(u, maxUndercover(n)) || defaultUndercover(n))
                }}
              >
                {n}
              </button>
            ))}
          </div>

          <div className="arc-field">
            <span>Undercover players (max {max})</span>
            <div className="arc-seg" role="group" aria-label="Undercover players">
              {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" aria-pressed={effective === n} className={effective === n ? 'selected' : ''} onClick={() => setUndercover(n)}>{n}</button>
              ))}
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
  const seq = state.seq
  const n = settings.names.length
  const nm = settings.names

  let body: React.ReactNode
  if (state.phase === 'reveal') {
    const p = state.revealIndex
    body = privacy.covered ? (
      <PrivateCover
        kicker={`WORD ${p + 1} OF ${n}`}
        title={`Pass to ${nm[p]}`}
        text={`Only ${nm[p]} should look. Everyone else, look away.`}
        button={`I’m ${nm[p]}. Show my word`}
        onReveal={privacy.reveal}
      />
    ) : (
      <div className="arc-body arc-center">
        <p className="arc-kicker">{nm[p].toUpperCase()} · YOUR SECRET WORD</p>
        <p className="arc-big" role="status">{wordFor(state, p)}</p>
        <p className="arc-text">Remember it. Don’t say it and don’t show anyone. You will describe it without naming it.</p>
        <button type="button" className="arc-btn arc-primary" onClick={() => { privacy.hide(); act((s) => acknowledgeWord(s, seq)) }}>
          Hide and pass on
        </button>
      </div>
    )
  } else if (state.phase === 'discuss') {
    const order = discussionOrder(state)
    const out = state.alive.map((a, i) => (a ? -1 : i)).filter((i) => i >= 0)
    body = (
      <div className="arc-body">
        <p className="arc-kicker">ROUND {state.round} · DISCUSSION</p>
        <p className="arc-text">Each player says one word or short phrase about their word, in this order, without naming it:</p>
        <ol className="order-list" aria-label="Speaking order">
          {order.map((p) => <li key={p}>{nm[p]}</li>)}
        </ol>
        {out.length ? <p className="arc-text">Out: {out.map((p) => `${nm[p]} (${roleLabel(state.roles[p])})`).join(', ')}</p> : null}
        <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => act((s) => startVote(s, seq))}>Start voting</button>
      </div>
    )
  } else if (state.phase === 'vote' && state.ballot) {
    body = (
      <BallotView
        names={nm}
        ballot={state.ballot}
        scope="uc"
        note={state.ballot.round === 2 ? 'Runoff: choose between the tied players only.' : undefined}
        onCast={(t) => act((s) => vote(s, seq, t))}
      />
    )
  } else if (state.phase === 'tally' && state.ballot && state.result) {
    const r = state.result
    body = (
      <div className="arc-body">
        <p className="arc-kicker">{state.ballot.round === 2 ? 'RUNOFF RESULT' : 'VOTE RESULT'}</p>
        <TallyList names={nm} ballot={state.ballot} />
        {r.kind === 'elected' ? (
          <p className="tv-result" role="status">{nm[r.player]} is out. They were {roleLabel(state.roles[r.player]).toLowerCase()}.</p>
        ) : r.kind === 'tie' ? (
          <p className="tv-result" role="status">Tie between {r.tied.map((p) => nm[p]).join(' and ')}. One runoff vote decides.</p>
        ) : (
          <p className="tv-result" role="status">Tied again. Nobody is eliminated this round.</p>
        )}
        {r.kind === 'tie' ? (
          <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => act((s) => startRunoff(s, seq))}>Runoff vote</button>
        ) : (
          <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => act((s) => continueGame(s, seq))}>{state.winner ? 'See result' : 'Next round'}</button>
        )}
      </div>
    )
  } else {
    // over
    body = (
      <div className="arc-body">
        <p className="arc-kicker">GAME OVER</p>
        <p className="arc-big" role="status">{state.winner === 'civilians' ? 'Civilians win' : 'Undercover win'}</p>
        <p className="arc-text">Civilian word: <strong>{state.words[0]}</strong> · Undercover word: <strong>{state.words[1]}</strong></p>
        <ul className="card-list" aria-label="Roles">
          {nm.map((name, i) => (
            <li key={i}><b>{state.roles[i] === 'undercover' ? 'U' : 'C'}</b> {name}{state.alive[i] ? '' : ' (out)'}</li>
          ))}
        </ul>
        <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => begin(settings)}>Play again</button>
        <button type="button" className="arc-btn" onClick={onExit}>Back to Arcade</button>
      </div>
    )
  }

  const showMenu = menu !== 'closed'
  const alive = aliveIndexes(state)
  return (
    <div className="arc-game">
      <div className="arc-contents" inert={showMenu}>
        <GameBar title="Undercover" backLabel={state.phase === 'over' ? '‹ ARCADE' : '‹ MENU'} onBack={state.phase === 'over' ? onExit : () => setMenu('open')} />
        {warning ? <Notice>Progress can’t be saved on this device right now. Playing without saving.</Notice> : null}
        {state.phase !== 'over' && state.phase !== 'reveal' ? <p className="arc-meta">{alive.length} of {n} players still in</p> : null}
        <div className="arc-play">{body}</div>
      </div>

      {showMenu ? (
        <div className="arc-overlay" role="dialog" aria-modal="true" aria-label="Game menu">
          {menu === 'open' ? (
            <>
              <p className="arc-lead">Paused</p>
              <p className="arc-text">Progress is saved on this device. Secrets stay hidden until the next person taps their cover.</p>
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
