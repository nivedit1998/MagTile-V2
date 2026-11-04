export type GameId =
  | 'mafia'
  | 'undercover'
  | 'wordrush'
  | 'charades'
  | 'battleships'
  | 'tictactoe'
  | 'hangman'
  | 'trivia'
  | 'minesweeper'
  | 'nonograms'

export interface GameEntry {
  id: GameId
  name: string
  type: string
  description: string
  /** false = tile routes to a "not built yet" screen (later phases). */
  available: boolean
}

export const ARCADE_GAMES: readonly GameEntry[] = [
  { id: 'mafia', name: 'Mafia / Werewolf', type: 'PASS & PLAY', description: 'Secret roles · night and day · voting', available: true },
  { id: 'undercover', name: 'Undercover', type: 'PASS & PLAY', description: 'Secret words · discussion · voting', available: true },
  { id: 'wordrush', name: 'Word Rush', type: 'TEAMS', description: 'Describe words · categories · timer', available: true },
  { id: 'charades', name: 'Charades', type: 'TEAMS', description: 'Movies and actions · prompts · timer', available: true },
  { id: 'battleships', name: 'Battleships', type: '2 PLAYERS', description: 'Hidden boards · take turns · sink ships', available: true },
  { id: 'tictactoe', name: 'Tic-Tac-Toe', type: '2 PLAYERS', description: 'Take turns · track the score', available: true },
  { id: 'hangman', name: 'Hangman', type: 'PASS & PLAY', description: 'Guess letters · use your own words', available: true },
  { id: 'trivia', name: 'Trivia Battle', type: 'PLAYERS OR TEAMS', description: 'Choose a quiz · play offline · keep score', available: true },
  { id: 'minesweeper', name: 'Minesweeper', type: 'SOLO', description: 'Offline number-grid puzzle', available: true },
  { id: 'nonograms', name: 'Nonograms', type: 'SOLO', description: 'Offline picture-logic puzzles', available: true },
]
