import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ARCADE_GAMES, type GameId } from './catalog'
import ContentScreen from './ContentScreen'
import { useContent } from './content/runtime'
import { runSync } from './content/sync'
import { GameErrorBoundary } from './shared/ErrorBoundary'
import { ComingSoon } from './shared/GameFrame'
import { stepFocus } from './shared/hardware'
import { applyUpdate, useOfflineStatus } from './offline/register'
import { listSavedIds } from './storage/saves'

// Each game is its own chunk so the list loads without game code.
const TicTacToeScreen = lazy(() => import('./games/tictactoe/TicTacToeScreen'))
const MinesweeperScreen = lazy(() => import('./games/minesweeper/MinesweeperScreen'))
const NonogramScreen = lazy(() => import('./games/nonograms/NonogramScreen'))
const HangmanScreen = lazy(() => import('./games/hangman/HangmanScreen'))
const WordRushScreen = lazy(() => import('./games/wordrush/WordRushScreen'))
const CharadesScreen = lazy(() => import('./games/charades/CharadesScreen'))
const TriviaScreen = lazy(() => import('./games/trivia/TriviaScreen'))
const UndercoverScreen = lazy(() => import('./games/undercover/UndercoverScreen'))
const MafiaScreen = lazy(() => import('./games/mafia/MafiaScreen'))
const BattleshipsScreen = lazy(() => import('./games/battleships/BattleshipsScreen'))

const GAME_SCREENS: Partial<Record<GameId, React.LazyExoticComponent<React.ComponentType<{ onExit: () => void }>>>> = {
  tictactoe: TicTacToeScreen,
  minesweeper: MinesweeperScreen,
  nonograms: NonogramScreen,
  hangman: HangmanScreen,
  wordrush: WordRushScreen,
  charades: CharadesScreen,
  trivia: TriviaScreen,
  undercover: UndercoverScreen,
  mafia: MafiaScreen,
  battleships: BattleshipsScreen,
}

export default function ArcadeScreen() {
  const [openGame, setOpenGame] = useState<GameId | null>(null)
  const [showContent, setShowContent] = useState(false)
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(new Set())
  const gameRef = useRef<HTMLDivElement>(null)
  const lastOpened = useRef<string | null>(null)
  const inGame = openGame !== null || showContent
  const offline = useOfflineStatus()
  const content = useContent(true)

  // Refresh "saved" markers whenever the list is shown.
  useEffect(() => {
    if (inGame) return
    let live = true
    listSavedIds().then((ids) => live && setSavedIds(new Set(ids)))
    return () => {
      live = false
    }
  }, [inGame])

  // Sparse content refresh: only from the menu list, never during a game. runSync enforces the
  // 24 hour limit, the online check and the cross-tab lock, so calling it on every list visit is cheap.
  useEffect(() => {
    if (inGame) return
    void runSync('auto')
  }, [inGame])

  // Returning from a game: focus the tile that was opened.
  useLayoutEffect(() => {
    if (inGame || !gameRef.current) return
    if (lastOpened.current) {
      gameRef.current.querySelector<HTMLElement>(`[data-game="${lastOpened.current}"]`)?.focus({ preventScroll: true })
    }
  }, [inGame])

  // Hardware page buttons: a discrete focus step through the visible controls. Nothing on screen scrolls.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'PageDown' && event.key !== 'PageUp') return
      event.preventDefault()
      if (gameRef.current) stepFocus(gameRef.current, event.key === 'PageDown' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const open = (id: GameId) => {
    lastOpened.current = id
    setOpenGame(id)
  }
  const close = () => setOpenGame(null)
  const openContent = () => {
    lastOpened.current = 'content'
    setShowContent(true)
  }

  if (showContent) {
    return (
      <section className="arcade-screen" aria-label="Content and credits" ref={gameRef}>
        <ContentScreen onBack={() => setShowContent(false)} />
      </section>
    )
  }

  if (openGame) {
    const entry = ARCADE_GAMES.find((g) => g.id === openGame)!
    const Screen = GAME_SCREENS[openGame]
    return (
      <section className="arcade-screen" aria-label={entry.name} ref={gameRef}>
        {Screen ? (
          <GameErrorBoundary onBack={close}>
            <Suspense fallback={<p className="arc-text arc-body">Loading…</p>}>
              <Screen onExit={close} />
            </Suspense>
          </GameErrorBoundary>
        ) : (
          <ComingSoon name={entry.name} onBack={close} />
        )}
      </section>
    )
  }

  return (
    <section className="arcade-screen" aria-label="Arcade games" ref={gameRef}>
      {offline.stale ? (
        <div className="arcade-update" role="status">
          <span>Updated in another tab. Reload to finish.</span>
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      ) : offline.updateWaiting ? (
        <div className="arcade-update" role="status">
          <span>Update ready. Saved games are kept.</span>
          <button type="button" onClick={applyUpdate}>Update now</button>
        </div>
      ) : null}
      <div className="arcade-game-list" role="group" aria-label="Games">
        {ARCADE_GAMES.map((game, index) => (
          <button className="arcade-game-tile" data-game={game.id} key={game.id} onClick={() => open(game.id)} type="button">
            <span className="arcade-game-number">{String(index + 1).padStart(2, '0')}{savedIds.has(game.id) ? ' · ● SAVED' : ''}</span>
            <span className="arcade-game-name">{game.name}</span>
            <span className="arcade-game-description">{game.description}</span>
            <span className="arcade-game-type">{game.type}</span>
          </button>
        ))}
        <button className="arcade-game-tile wide" data-game="content" onClick={openContent} type="button">
          <span className="arcade-game-name">Content &amp; credits</span>
          <span className="arcade-game-description">
            {content && [content.trivia, content.words, content.charades].some((s) => s.origin === 'downloaded') ? 'Updated packs' : 'Starter set'}
            {offline.ready ? ' · offline ready' : ''}
          </span>
        </button>
      </div>
    </section>
  )
}
