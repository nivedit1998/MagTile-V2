import { useCallback, useMemo, useRef, useState } from 'react'
import { buildPool, type Category } from '../../content/banks'
import { useContent } from '../../content/runtime'
import { GameBar, Notice } from '../../shared/GameFrame'
import { useGameSave } from '../../shared/useGameSave'
import {
  LIMIT_OPTIONS, MIN_POOL, didGuesserWin, guess, mistakes, newMatch, nextRound,
  normalizeWord, parseSettings, parseState, tiles, wrongLetters,
  type Limit, type Result, type Settings, type State,
} from './rules'
import type { Random } from '../../shared/deck'

const GAME_ID = 'hangman'
const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
const NAMES: [string, string] = ['Player 1', 'Player 2']
const browserRandom: Random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296

const PARTS = 8
function Gallows({ shown }: { shown: number }) {
  const parts = [
    <circle key="head" cx="80" cy="38" r="12" />,
    <line key="body" x1="80" y1="50" x2="80" y2="84" />,
    <line key="armL" x1="80" y1="58" x2="62" y2="72" />,
    <line key="armR" x1="80" y1="58" x2="98" y2="72" />,
    <line key="legL" x1="80" y1="84" x2="64" y2="106" />,
    <line key="legR" x1="80" y1="84" x2="96" y2="106" />,
    <line key="footL" x1="64" y1="106" x2="55" y2="106" />,
    <line key="footR" x1="96" y1="106" x2="105" y2="106" />,
  ]
  return (
    <svg className="hm-gallows" viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" aria-hidden="true">
      <line x1="14" y1="112" x2="60" y2="112" />
      <line x1="30" y1="112" x2="30" y2="10" />
      <line x1="30" y1="10" x2="80" y2="10" />
      <line x1="80" y1="10" x2="80" y2="26" />
      {parts.slice(0, shown)}
    </svg>
  )
}

interface Props {
  onExit: () => void
}

/** Opens with one snapshot of the content (starter set or the installed words pack) for the whole session. */
export default function HangmanScreen({ onExit }: Props) {
  const content = useContent()
  if (!content) {
    return (
      <div className="arc-game">
        <GameBar title="Hangman" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body arc-center"><p className="arc-text">Loading…</p></div>
      </div>
    )
  }
  return <HangmanGame onExit={onExit} categories={content.words.categories} version={content.words.version} />
}

function HangmanGame({ onExit, categories, version }: Props & { categories: readonly Category[]; version: number }) {
  const knownIds = useMemo(() => categories.map((c) => c.id), [categories])
  const poolWords = useCallback(
    (ids: readonly string[]): string[] =>
      buildPool(categories, ids).map((c) => {
        const n = normalizeWord(c.text)
        return n.ok ? n.word : c.text.toUpperCase()
      }),
    [categories],
  )
  // Typed custom words need a keyboard, which this device does not have: such old saves are not resumable.
  const parse = useCallback(
    (rawSettings: unknown, rawState: unknown): { settings: Settings; state: State } | null => {
      const settings = parseSettings(rawSettings, knownIds)
      if (!settings || settings.mode !== 'random') return null
      const state = parseState(rawState, settings, poolWords(settings.categoryIds))
      return state ? { settings, state } : null
    },
    [knownIds, poolWords],
  )
  const { loading, saved, warning, save, clear } = useGameSave<Settings, State>(GAME_ID, version, parse)

  // Setup
  const [limit, setLimit] = useState<Limit>(6)
  const [cats, setCats] = useState<string[]>(() => (knownIds.includes('animals') ? ['animals'] : knownIds.slice(0, 1)))
  const [setupNote, setSetupNote] = useState<string | null>(null)
  const [confirmNew, setConfirmNew] = useState(false)

  // Play
  const [settings, setSettings] = useState<Settings | null>(null)
  const [state, setState] = useState<State | null>(null)
  const [menu, setMenu] = useState<'closed' | 'open' | 'confirm'>('closed')
  const stateRef = useRef<State | null>(null)

  const pool = useMemo(() => (settings ? poolWords(settings.categoryIds) : []), [settings, poolWords])

  const commit = (next: State, s: Settings) => {
    stateRef.current = next
    setState(next)
    void save(s, next)
  }

  const begin = (s: Settings) => {
    const st = newMatch(s, poolWords(s.categoryIds), browserRandom)
    stateRef.current = st
    setSettings(s)
    setState(st)
    setMenu('closed')
    void save(s, st, true)
  }

  const act = (fn: (s: State, cfg: Settings) => Result<State>) => {
    const cur = stateRef.current
    if (!cur || !settings) return
    const r = fn(cur, settings)
    if (!r.ok) return
    commit(r.state, settings)
  }

  if (loading) {
    return (
      <div className="arc-game">
        <GameBar title="Hangman" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body arc-center"><p className="arc-text">Loading…</p></div>
      </div>
    )
  }

  // ---- Setup -----------------------------------------------------------------
  if (!state || !settings) {
    const poolSize = buildPool(categories, cats).length
    const startNew = () => {
      setSetupNote(null)
      if (cats.length === 0) return setSetupNote('Pick at least one category.')
      if (poolSize < MIN_POOL) return setSetupNote(`Not enough words (${poolSize}). Pick more categories.`)
      if (saved.kind === 'ok' && !confirmNew) {
        setConfirmNew(true)
        return
      }
      begin({ names: NAMES, mode: 'random', limit, categoryIds: cats })
    }
    return (
      <div className="arc-game">
        <GameBar title="Hangman" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body">
          {saved.kind === 'ok' ? (
            <div className="arc-card">
              <p className="arc-text">Saved game · word {saved.state.round} · {saved.state.scores[0]}–{saved.state.scores[1]}</p>
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

          <p className="arc-lead">Hangman</p>
          <p className="arc-text arc-rules">Two players take turns guessing a random word. Tap letters. A solved word scores 1.</p>

          <div className="arc-field">
            <span>Categories · {poolSize} words</span>
            <div className="cat-list" role="group" aria-label="Categories">
              {categories.map((c) => {
                const on = cats.includes(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`cat-chip${on ? ' on' : ''}`}
                    aria-pressed={on}
                    disabled={c.cards.length === 0}
                    onClick={() => setCats((cur) => (cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id]))}
                  >
                    <span>{on ? '✓ ' : ''}{c.name}</span>
                    <small>{c.cards.length === 0 ? 'no words yet' : `${c.cards.length} words`}</small>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="arc-field">
            <span>Wrong guesses allowed</span>
            <div className="arc-seg" role="group" aria-label="Wrong guesses allowed">
              {LIMIT_OPTIONS.map((n) => (
                <button key={n} type="button" aria-pressed={limit === n} className={limit === n ? 'selected' : ''} onClick={() => setLimit(n)}>{n}</button>
              ))}
            </div>
          </div>

          <div className="arc-spacer" />
          {setupNote ? <Notice>{setupNote}</Notice> : null}
          {confirmNew ? <Notice>This replaces your saved game.</Notice> : null}
          <button type="button" className="arc-btn arc-primary" onClick={startNew}>{confirmNew ? 'Replace and start' : 'Start game'}</button>
        </div>
      </div>
    )
  }

  // ---- Play ------------------------------------------------------------------
  const guesserName = settings.names[state.guesser]
  const wrong = wrongLetters(state)
  const miss = mistakes(state)
  const over = state.phase === 'result'
  const won = didGuesserWin(state)
  const words = (() => {
    const groups: ReturnType<typeof tiles>[] = [[]]
    for (const t of tiles(state, over)) {
      if (t.ch === ' ') groups.push([])
      else groups[groups.length - 1].push(t)
    }
    return groups.filter((g) => g.length > 0)
  })()

  return (
    <div className="arc-game">
      <div className="arc-contents" inert={menu !== 'closed'}>
        <GameBar title="Hangman" backLabel={over ? '‹ ARCADE' : '‹ MENU'} onBack={over ? onExit : () => setMenu('open')} />
        {warning ? <Notice>Progress can’t be saved on this device right now. Playing without saving.</Notice> : null}
        <div className="arc-play">
          <div className="hm-score" aria-label="Scores">
            {([0, 1] as const).map((p) => (
              <div key={p} className={`hm-score-cell${state.guesser === p ? ' on-turn' : ''}`}>
                <span className="arc-name">{settings.names[p]}</span>
                <span className="arc-wins">{state.scores[p]}</span>
              </div>
            ))}
          </div>
          <div className="hm-top">
            <Gallows shown={miss === 0 ? 0 : Math.min(PARTS, Math.ceil((miss * PARTS) / settings.limit))} />
            <div className="hm-info">
              <p className="hm-count">Mistakes <strong>{miss}/{settings.limit}</strong></p>
              <p className="hm-wrong" aria-label="Wrong letters">{wrong.length ? `Wrong: ${wrong.join(' ')}` : 'No wrong letters yet'}</p>
            </div>
          </div>
          <div className="hm-word" role="group" aria-label={over ? `The word was ${state.word}` : 'Word to guess'}>
            {words.map((g, wi) => (
              <span className="hm-wordgroup" key={wi}>
                {g.map((t, ti) => (
                  <span key={ti} className={`hm-tile${t.letter ? '' : ' punct'}${over && t.letter && !state.guessed.includes(t.ch) ? ' missed' : ''}`} aria-label={t.shown ? t.ch : 'blank'}>
                    {t.shown ? t.ch : ''}
                  </span>
                ))}
              </span>
            ))}
          </div>
          {over ? (
            <div className="arc-turn">
              <p className="arc-status" role="status">{won ? `${guesserName} solved it!` : 'Out of guesses.'}</p>
              <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => act((s, cfg) => nextRound(s, cfg, pool, browserRandom))}>Next word</button>
            </div>
          ) : (
            <p className="hm-turn" role="status">{guesserName} to guess</p>
          )}
          <div className="hm-keys" role="group" aria-label="Letters" data-page-jump={7}>
            {LETTERS.map((l) => {
              const tried = state.guessed.includes(l)
              const hit = tried && (state.word ?? '').includes(l)
              return (
                <button
                  key={l}
                  type="button"
                  className={`hm-key${hit ? ' hit' : ''}${tried && !hit ? ' miss' : ''}`}
                  aria-disabled={tried || over ? true : undefined}
                  aria-label={`${l}${tried ? (hit ? ', in the word' : ', not in the word') : ''}`}
                  onClick={() => act((s, cfg) => guess(s, cfg, l))}
                >
                  {l}
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
