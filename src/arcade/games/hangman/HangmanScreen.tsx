import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildPool, type Category } from '../../content/banks'
import { useContent } from '../../content/runtime'
import { GameBar, Notice } from '../../shared/GameFrame'
import { useGameSave } from '../../shared/useGameSave'
import { readPref, writePref } from '../../storage/saves'
import {
  LIMIT_OPTIONS, MAX_NAME_LENGTH, MAX_WORD_LENGTH, MIN_POOL, didGuesserWin, guess, mistakes, newMatch, nextRound,
  normalizeWord, parseSettings, parseState, setWord, setterOf, tiles, validateNames, wrongLetters,
  type Limit, type Mode, type Result, type Settings, type State,
} from './rules'
import type { Random } from '../../shared/deck'

const GAME_ID = 'hangman'
const NAMES_PREF = 'magtile.arcade.hangman.names'
const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
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
  const parse = useCallback(
    (rawSettings: unknown, rawState: unknown): { settings: Settings; state: State } | null => {
      const settings = parseSettings(rawSettings, knownIds)
      const state = settings ? parseState(rawState, settings, settings.mode === 'random' ? poolWords(settings.categoryIds) : []) : null
      return settings && state ? { settings, state } : null
    },
    [knownIds, poolWords],
  )
  const { loading, saved, warning, save, clear } = useGameSave<Settings, State>(GAME_ID, version, parse)

  // Setup form
  const [names, setNames] = useState<[string, string]>(() => {
    const p = readPref<unknown>(NAMES_PREF)
    return Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string' ? [p[0].slice(0, MAX_NAME_LENGTH), p[1].slice(0, MAX_NAME_LENGTH)] : ['', '']
  })
  const [mode, setMode] = useState<Mode>('random')
  const [limit, setLimit] = useState<Limit>(6)
  const [cats, setCats] = useState<string[]>(() => (knownIds.includes('animals') ? ['animals'] : knownIds.slice(0, 1)))
  const [errors, setErrors] = useState<[string | null, string | null]>([null, null])
  const [setupNote, setSetupNote] = useState<string | null>(null)
  const [confirmNew, setConfirmNew] = useState(false)

  // Play
  const [settings, setSettings] = useState<Settings | null>(null)
  const [state, setState] = useState<State | null>(null)
  const [menu, setMenu] = useState<'closed' | 'open' | 'confirm'>('closed')
  const [covered, setCovered] = useState(false)
  const [secret, setSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [secretError, setSecretError] = useState<string | null>(null)
  const stateRef = useRef<State | null>(null)

  const pool = useMemo(() => (settings?.mode === 'random' ? poolWords(settings.categoryIds) : []), [settings, poolWords])

  const commit = (next: State, s: Settings) => {
    stateRef.current = next
    setState(next)
    void save(s, next)
  }

  const begin = (s: Settings) => {
    const st = newMatch(s, s.mode === 'random' ? poolWords(s.categoryIds) : [], browserRandom)
    stateRef.current = st
    setSettings(s)
    setState(st)
    setMenu('closed')
    setCovered(false)
    setSecret('')
    void save(s, st, true)
  }

  const act = (fn: (s: State, cfg: Settings) => Result<State>) => {
    const cur = stateRef.current
    if (!cur || !settings) return
    const r = fn(cur, settings)
    if (!r.ok) return
    commit(r.state, settings)
  }

  // Never leave a typed secret word on screen when the page is hidden.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) {
        setSecret('')
        setShowSecret(false)
      }
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [])

  // Physical keyboard letters guess too (only while a guess is possible and no text field has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const cur = stateRef.current
      if (!cur || cur.phase !== 'play' || covered || menu !== 'closed' || !/^[a-z]$/i.test(e.key)) return
      e.preventDefault()
      act((s, cfg) => guess(s, cfg, e.key))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // act reads refs and the current settings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [covered, menu, settings])

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
      const check = validateNames(names[0], names[1])
      setErrors(check.errors)
      setSetupNote(null)
      if (!check.ok) return
      if (mode === 'random') {
        if (cats.length === 0) return setSetupNote('Pick at least one category.')
        if (poolSize < MIN_POOL) return setSetupNote(`Not enough words (${poolSize}). Pick more categories.`)
      }
      if (saved.kind === 'ok' && !confirmNew) {
        setConfirmNew(true)
        return
      }
      writePref(NAMES_PREF, check.names)
      setNames(check.names)
      begin({ names: check.names, mode, limit, categoryIds: mode === 'random' ? cats : [] })
    }
    return (
      <div className="arc-game">
        <GameBar title="Hangman" backLabel="‹ ARCADE" onBack={onExit} />
        <form className="arc-body" onSubmit={(e) => { e.preventDefault(); startNew() }} noValidate>
          {saved.kind === 'ok' ? (
            <div className="arc-card">
              <p className="arc-lead">Saved game</p>
              <p className="arc-text">
                {saved.settings.names[0]} vs {saved.settings.names[1]} · word {saved.state.round} · {saved.state.scores[0]}–{saved.state.scores[1]}
              </p>
              <button
                type="button"
                className="arc-btn arc-primary"
                onClick={() => {
                  stateRef.current = saved.state
                  setSettings(saved.settings)
                  setState(saved.state)
                  // A custom word is secret: resume behind a cover until the guesser confirms.
                  setCovered(saved.settings.mode === 'custom' && saved.state.phase === 'play')
                }}
              >
                Resume game
              </button>
            </div>
          ) : null}
          {saved.kind === 'bad' ? <Notice>{saved.reason} Starting a new game replaces it.</Notice> : null}

          <p className="arc-text arc-rules">
            Two players take turns guessing. Spaces and punctuation are shown. Repeated letters are ignored.
            A solved word scores 1 for the guesser; a failed custom word scores 1 for the word setter.
          </p>

          {([0, 1] as const).map((i) => (
            <label className="arc-field" key={i}>
              <span>Player {i + 1}</span>
              <input
                value={names[i]}
                maxLength={MAX_NAME_LENGTH}
                autoComplete="off"
                onChange={(e) => setNames((cur) => (i === 0 ? [e.target.value, cur[1]] : [cur[0], e.target.value]))}
                aria-invalid={errors[i] !== null}
              />
              {errors[i] ? <em>{errors[i]}</em> : null}
            </label>
          ))}

          <div className="arc-seg" role="group" aria-label="Word source">
            <button type="button" aria-pressed={mode === 'random'} className={mode === 'random' ? 'selected' : ''} onClick={() => setMode('random')}>Random word</button>
            <button type="button" aria-pressed={mode === 'custom'} className={mode === 'custom' ? 'selected' : ''} onClick={() => setMode('custom')}>Custom word</button>
          </div>

          {mode === 'random' ? (
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
          ) : (
            <p className="arc-text arc-rules">One player types a secret word or phrase on the next screen, then hands the device over.</p>
          )}

          <div className="arc-field">
            <span>Wrong guesses allowed</span>
            <div className="arc-seg" role="group" aria-label="Wrong guesses allowed">
              {LIMIT_OPTIONS.map((n) => (
                <button key={n} type="button" aria-pressed={limit === n} className={limit === n ? 'selected' : ''} onClick={() => setLimit(n)}>{n}</button>
              ))}
            </div>
          </div>

          {setupNote ? <Notice>{setupNote}</Notice> : null}
          {confirmNew ? <Notice>This replaces your saved game.</Notice> : null}
          <button type="submit" className="arc-btn arc-primary">{confirmNew ? 'Replace and start' : 'Start game'}</button>
        </form>
      </div>
    )
  }

  // ---- Play ------------------------------------------------------------------
  const guesserName = settings.names[state.guesser]
  const setterName = settings.names[setterOf(state)]
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

  const scoreRow = (
    <div className="hm-score" aria-label="Scores">
      {([0, 1] as const).map((p) => (
        <div key={p} className={`hm-score-cell${state.guesser === p ? ' on-turn' : ''}`}>
          <span className="arc-name">{settings.names[p]}</span>
          <span className="arc-wins">{state.scores[p]}</span>
        </div>
      ))}
    </div>
  )

  let body: React.ReactNode
  if (state.phase === 'word') {
    const lock = () => {
      const r = setWord(state, secret)
      if (!r.ok) {
        setSecretError(r.reason)
        return
      }
      setSecretError(null)
      setSecret('')
      setShowSecret(false)
      setCovered(true) // hand-off cover before the guesser sees anything
      commit(r.state, settings)
    }
    body = (
      <>
        {scoreRow}
        <form className="arc-body" onSubmit={(e) => { e.preventDefault(); lock() }} noValidate>
          <p className="arc-kicker">WORD {state.round} · {setterName.toUpperCase()} SETS THE WORD</p>
          <p className="arc-text">{guesserName}, look away. {setterName}, type a secret word or phrase, then lock it.</p>
          <label className="arc-field">
            <span>Secret word</span>
            <input
              type={showSecret ? 'text' : 'password'}
              value={secret}
              maxLength={MAX_WORD_LENGTH}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => setSecret(e.target.value)}
              aria-invalid={secretError !== null}
            />
            {secretError ? <em>{secretError}</em> : null}
          </label>
          <button type="button" className="arc-btn" onClick={() => setShowSecret((v) => !v)}>{showSecret ? 'Hide word' : 'Show word'}</button>
          <button type="submit" className="arc-btn arc-primary">Lock word and hand over</button>
        </form>
      </>
    )
  } else if (covered) {
    body = (
      <>
        {scoreRow}
        <div className="arc-body arc-center">
          <p className="arc-kicker">WORD {state.round}</p>
          <p className="arc-big">Pass to {guesserName}</p>
          <p className="arc-text">The secret word is hidden. {guesserName} guesses; {setterName} keeps the secret.</p>
          <button type="button" className="arc-btn arc-primary" autoFocus onClick={() => setCovered(false)}>I’m {guesserName}. Start</button>
        </div>
      </>
    )
  } else {
    body = (
      <>
        {scoreRow}
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
            <p className="arc-status" role="status">
              {won ? `${guesserName} solved it!` : `Out of guesses. ${settings.mode === 'custom' ? `${setterName} scores.` : ''}`}
            </p>
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
      </>
    )
  }

  const bar = <GameBar title="Hangman" backLabel={over ? '‹ ARCADE' : '‹ MENU'} onBack={over ? onExit : () => setMenu('open')} />

  return (
    <div className="arc-game">
      <div className="arc-contents" inert={menu !== 'closed'}>
        {bar}
        {warning ? <Notice>Progress can’t be saved on this device right now. Playing without saving.</Notice> : null}
        <div className="arc-play">{body}</div>
      </div>

      {menu !== 'closed' ? (
        <div className="arc-overlay" role="dialog" aria-modal="true" aria-label="Game menu">
          {menu === 'open' ? (
            <>
              <p className="arc-lead">Paused</p>
              <p className="arc-text">Progress is saved on this device.{settings.mode === 'custom' ? ' A custom secret word is kept on this device until the round ends.' : ''}</p>
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
