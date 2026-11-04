import { useRef, useState } from 'react'
import type { Random } from '../../shared/deck'
import { GameBar, Notice } from '../../shared/GameFrame'
import { BallotView, PrivateCover, TallyList } from '../../shared/PrivateCover'
import { useGameSave } from '../../shared/useGameSave'
import { usePrivacy } from '../../shared/usePrivacy'
import {
  GAME_VERSION, MAX_PLAYERS, MIN_PLAYERS, acknowledgeRole, aliveIndexes, chooseVictim, continueGame, defaultMafia, inspect, mafiaPartners, maxMafia,
  newGame, parseSettings, parseState, protect, resolveNight, roleAlive, startDay, startRunoff, startVote, validateSetup, vote,
  type Result, type Role, type Settings, type State,
} from './rules'

const GAME_ID = 'mafia'
const browserRandom: Random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296

function parse(rawSettings: unknown, rawState: unknown): { settings: Settings; state: State } | null {
  const settings = parseSettings(rawSettings)
  const state = settings ? parseState(rawState, settings) : null
  return settings && state ? { settings, state } : null
}

const ROLE_NAME: Record<Role, string> = { mafia: 'Mafia', seer: 'Seer', doctor: 'Doctor', villager: 'Villager' }
const ROLE_HELP: Record<Role, string> = {
  mafia: 'Each night, with your partners, silently choose a villager to eliminate. Stay hidden by day.',
  seer: 'Each night the moderator lets you inspect one player and tells you only “Mafia” or “not Mafia”.',
  doctor: 'Each night you protect one player (yourself included). If the Mafia attack them, they survive.',
  villager: 'You have no night action. Find the Mafia by talking and voting.',
}

interface Props {
  onExit: () => void
}

export default function MafiaScreen({ onExit }: Props) {
  const { loading, saved, warning, save, clear } = useGameSave<Settings, State>(GAME_ID, GAME_VERSION, parse)

  const [names, setNames] = useState<string[]>(['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5'])
  const [mafia, setMafia] = useState(1)
  const [setupNote, setSetupNote] = useState<string | null>(null)
  const [confirmNew, setConfirmNew] = useState(false)

  const [settings, setSettings] = useState<Settings | null>(null)
  const [state, setState] = useState<State | null>(null)
  const [menu, setMenu] = useState<'closed' | 'open' | 'confirm'>('closed')
  const [pick, setPick] = useState<{ key: string; target: number } | null>(null)
  const stateRef = useRef<State | null>(null)

  const secretKey =
    state && state.phase === 'assign'
      ? `mf-role-${state.assignIndex}`
      : state && (state.phase === 'night-mafia' || state.phase === 'night-doctor' || state.phase === 'night-seer')
        ? `mf-night-${state.nightNumber}-${state.phase}`
        : null
  const privacy = usePrivacy(secretKey)

  const commit = (next: State, s: Settings) => {
    stateRef.current = next
    setState(next)
    if (next.phase === 'over') void clear()
    else void save(s, next)
  }

  const begin = (s: Settings) => {
    const st = newGame(s, browserRandom)
    stateRef.current = st
    setSettings(s)
    setState(st)
    setMenu('closed')
    setPick(null)
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
        <GameBar title="Mafia" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body arc-center"><p className="arc-text">Loading…</p></div>
      </div>
    )
  }

  // ---- Setup -----------------------------------------------------------------
  if (!state || !settings) {
    const max = maxMafia(names.length)
    const effective = Math.min(mafia, max)
    const startNew = () => {
      const check = validateSetup(names, effective)
      setSetupNote(check.mafiaError)
      if (!check.ok) return
      if (saved.kind === 'ok' && !confirmNew) {
        setConfirmNew(true)
        return
      }
      begin({ names: check.names, mafia: effective })
    }
    return (
      <div className="arc-game">
        <GameBar title="Mafia" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body">
          {saved.kind === 'ok' ? (
            <div className="arc-card">
              <p className="arc-lead">Saved game</p>
              <p className="arc-text">{saved.settings.names.length} players · night {saved.state.nightNumber} · {saved.state.alive.filter(Boolean).length} alive</p>
              <button type="button" className="arc-btn arc-primary" onClick={() => { stateRef.current = saved.state; setSettings(saved.settings); setState(saved.state) }}>Resume game (covered)</button>
            </div>
          ) : null}
          {saved.kind === 'bad' ? <Notice>{saved.reason} Starting a new game replaces it.</Notice> : null}

          <p className="arc-lead">Mafia</p>
          <p className="arc-text arc-rules">A separate <strong>moderator</strong> (not a player) holds the device and sees all secrets. One Seer, one Doctor, some Mafia, the rest Villagers. Roles are shown one at a time behind a cover.</p>
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
                  setMafia(defaultMafia(n))
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="arc-field">
            <span>Mafia players (max {max})</span>
            <div className="arc-seg" role="group" aria-label="Mafia players">
              {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" aria-pressed={effective === n} className={effective === n ? 'selected' : ''} onClick={() => setMafia(n)}>{n}</button>
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
  const nm = settings.names
  const seq = state.seq
  const alive = aliveIndexes(state)
  const selected = pick && pick.key === secretKey ? pick.target : null
  const choose = (t: number) => secretKey && setPick({ key: secretKey, target: t })

  const sheet = (
    <ul className="mod-sheet" aria-label="Moderator sheet">
      {nm.map((name, i) => (
        <li key={i} className={state.alive[i] ? '' : 'dead'}>
          <span>{name}</span>
          <span>{ROLE_NAME[state.roles[i]]}{state.alive[i] ? '' : ' · out'}</span>
        </li>
      ))}
    </ul>
  )

  const targetList = (eligible: number[]) => (
    <div className="vote-list" role="group" aria-label="Choose a player" data-page-jump={1}>
      {eligible.map((t) => (
        <button key={t} type="button" aria-pressed={selected === t} className={`vote-option${selected === t ? ' on' : ''}`} onClick={() => choose(t)}>
          {selected === t ? '✓ ' : ''}{nm[t]}
        </button>
      ))}
    </div>
  )

  const modCover = (what: string) => (
    <PrivateCover
      kicker={`NIGHT ${state.nightNumber}`}
      title="Moderator only"
      text={`Everyone else: eyes closed. ${what}`}
      button="I’m the moderator. Show"
      onReveal={privacy.reveal}
    />
  )

  let body: React.ReactNode
  if (state.phase === 'assign') {
    const p = state.assignIndex
    const role = state.roles[p]
    body = privacy.covered ? (
      <PrivateCover kicker={`ROLE ${p + 1} OF ${nm.length}`} title={`Pass to ${nm[p]}`} text={`Only ${nm[p]} should look. The moderator hands the device over.`} button={`I’m ${nm[p]}. Show my role`} onReveal={privacy.reveal} />
    ) : (
      <div className="arc-body arc-center">
        <p className="arc-kicker">{nm[p].toUpperCase()} · YOUR SECRET ROLE</p>
        <p className="arc-big" role="status">{ROLE_NAME[role]}</p>
        <p className="arc-text">{ROLE_HELP[role]}</p>
        {role === 'mafia' ? <p className="arc-text">Your partner{mafiaPartners(state, p).length === 1 ? ' is' : 's are'}: <strong>{mafiaPartners(state, p).map((i) => nm[i]).join(', ') || 'nobody else'}</strong></p> : null}
        <button type="button" className="arc-btn arc-primary" onClick={() => { privacy.hide(); act((s) => acknowledgeRole(s, seq)) }}>Hide and hand back</button>
      </div>
    )
  } else if (state.phase === 'night-mafia') {
    body = privacy.covered ? modCover('Mafia step.') : (
      <div className="arc-body">
        <p className="arc-kicker">MODERATOR · MAFIA WAKE</p>
        <p className="arc-text">Mafia open your eyes and silently point at a victim. Tap the player they chose.</p>
        {targetList(alive.filter((i) => state.roles[i] !== 'mafia'))}
        <button type="button" className="arc-btn arc-primary" disabled={selected === null} onClick={() => selected !== null && act((s) => chooseVictim(s, s.seq, selected))}>Confirm victim</button>
        {sheet}
      </div>
    )
  } else if (state.phase === 'night-doctor') {
    const doctorAlive = roleAlive(state, 'doctor')
    body = privacy.covered ? modCover('Doctor step.') : (
      <div className="arc-body">
        <p className="arc-kicker">MODERATOR · DOCTOR WAKE</p>
        {doctorAlive ? (
          <>
            <p className="arc-text">Doctor, open your eyes and point at who to protect (yourself is allowed).</p>
            {targetList(alive)}
            <button type="button" className="arc-btn arc-primary" disabled={selected === null} onClick={() => selected !== null && act((s) => protect(s, s.seq, selected))}>Confirm protection</button>
          </>
        ) : (
          <>
            <p className="arc-text">The Doctor is out and takes no action. Pause as if they chose, so nothing is given away.</p>
            <button type="button" className="arc-btn arc-primary" onClick={() => act((s) => protect(s, s.seq, null))}>Continue</button>
          </>
        )}
        {sheet}
      </div>
    )
  } else if (state.phase === 'night-seer') {
    const seerAlive = roleAlive(state, 'seer')
    body = privacy.covered ? modCover('Seer step.') : (
      <div className="arc-body">
        <p className="arc-kicker">MODERATOR · SEER WAKE</p>
        {seerAlive ? (
          state.night.inspect === null ? (
            <>
              <p className="arc-text">Seer, open your eyes and point at someone to inspect.</p>
              {targetList(alive.filter((i) => state.roles[i] !== 'seer'))}
              <button type="button" className="arc-btn arc-primary" disabled={selected === null} onClick={() => selected !== null && act((s) => inspect(s, s.seq, selected))}>Inspect</button>
            </>
          ) : (
            <>
              <p className="arc-big" role="status">{state.night.seerSaw ? 'MAFIA' : 'NOT MAFIA'}</p>
              <p className="arc-text">{nm[state.night.inspect]} is {state.night.seerSaw ? 'Mafia' : 'not Mafia'}. Show the Seer: thumbs down for Mafia, thumbs up otherwise. Then everyone wakes at dawn.</p>
              <button type="button" className="arc-btn arc-primary" onClick={() => { privacy.hide(); act((s) => resolveNight(s, s.seq)) }}>Hide and resolve the night</button>
            </>
          )
        ) : (
          <>
            <p className="arc-text">The Seer is out and takes no action. Pause as if they chose.</p>
            <button type="button" className="arc-btn arc-primary" onClick={() => { privacy.hide(); act((s) => { const r = inspect(s, s.seq, null); return r.ok ? resolveNight(r.state, r.state.seq) : r }) }}>Continue to dawn</button>
          </>
        )}
        {sheet}
      </div>
    )
  } else if (state.phase === 'dawn') {
    const d = state.death
    body = (
      <div className="arc-body arc-center">
        <p className="arc-kicker">DAWN · NIGHT {state.nightNumber}</p>
        <p className="arc-big" role="status">{d ? `${nm[d.player]} was killed` : 'Nobody died'}</p>
        <p className="arc-text">{d ? `They were the ${ROLE_NAME[state.roles[d.player]]}. They take no further part.` : 'The night passed quietly.'}</p>
        <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => act((s) => startDay(s, seq))}>{state.winner ? 'See result' : 'Start the day'}</button>
      </div>
    )
  } else if (state.phase === 'day') {
    const out = state.alive.map((a, i) => (a ? -1 : i)).filter((i) => i >= 0)
    body = (
      <div className="arc-body">
        <p className="arc-kicker">DAY {state.nightNumber} · DISCUSSION</p>
        <p className="arc-text">Talk it over, then vote someone out. Alive: {alive.map((i) => nm[i]).join(', ')}.</p>
        {out.length ? <p className="arc-text">Out: {out.map((p) => `${nm[p]} (${ROLE_NAME[state.roles[p]]})`).join(', ')}</p> : null}
        <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => act((s) => startVote(s, seq))}>Start voting</button>
      </div>
    )
  } else if (state.phase === 'vote' && state.ballot) {
    body = <BallotView names={nm} ballot={state.ballot} scope="mf" note={state.ballot.round === 2 ? 'Runoff: choose between the tied players only.' : undefined} onCast={(t) => act((s) => vote(s, seq, t))} />
  } else if (state.phase === 'tally' && state.ballot && state.result) {
    const r = state.result
    body = (
      <div className="arc-body">
        <p className="arc-kicker">{state.ballot.round === 2 ? 'RUNOFF RESULT' : 'VOTE RESULT'}</p>
        <TallyList names={nm} ballot={state.ballot} />
        {r.kind === 'elected' ? (
          <p className="tv-result" role="status">{nm[r.player]} is voted out. They were the {ROLE_NAME[state.roles[r.player]]}.</p>
        ) : r.kind === 'tie' ? (
          <p className="tv-result" role="status">Tie between {r.tied.map((p) => nm[p]).join(' and ')}. One runoff vote decides.</p>
        ) : (
          <p className="tv-result" role="status">Tied again. Nobody is eliminated today.</p>
        )}
        {r.kind === 'tie' ? (
          <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => act((s) => startRunoff(s, seq))}>Runoff vote</button>
        ) : (
          <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => act((s) => continueGame(s, seq))}>{state.winner ? 'See result' : 'Night falls'}</button>
        )}
      </div>
    )
  } else {
    body = (
      <div className="arc-body">
        <p className="arc-kicker">GAME OVER</p>
        <p className="arc-big" role="status">{state.winner === 'villagers' ? 'Villagers win' : 'Mafia win'}</p>
        {sheet}
        <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => begin(settings)}>Play again</button>
        <button type="button" className="arc-btn" onClick={onExit}>Back to Arcade</button>
      </div>
    )
  }

  const showMenu = menu !== 'closed'
  return (
    <div className="arc-game">
      <div className="arc-contents" inert={showMenu}>
        <GameBar title="Mafia" backLabel={state.phase === 'over' ? '‹ ARCADE' : '‹ MENU'} onBack={state.phase === 'over' ? onExit : () => setMenu('open')} />
        {warning ? <Notice>Progress can’t be saved on this device right now. Playing without saving.</Notice> : null}
        <div className="arc-play">{body}</div>
      </div>

      {showMenu ? (
        <div className="arc-overlay" role="dialog" aria-modal="true" aria-label="Game menu">
          {menu === 'open' ? (
            <>
              <p className="arc-lead">Paused</p>
              <p className="arc-text">Progress is saved on this device. Secret screens stay covered until the right person taps.</p>
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
