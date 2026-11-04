// Bundled original starter nonograms (5 x 5). Every puzzle here is verified to have exactly
// one solution by `node src/arcade/games/nonograms/rules.check.ts`. Add new puzzles only after
// that check passes. Pictures are original and carry no third-party licence obligations.
import { type Puzzle, type PuzzleDef, toPuzzle } from '../games/nonograms/rules.ts'

export const NONOGRAM_DEFS: readonly PuzzleDef[] = [
  { id: 'heart', name: 'Heart', rows: ['.#.#.', '#####', '#####', '.###.', '..#..'] },
  { id: 'plus', name: 'Plus', rows: ['..#..', '..#..', '#####', '..#..', '..#..'] },
  { id: 'arrow', name: 'Arrow', rows: ['..#..', '.###.', '#####', '..#..', '..#..'] },
  { id: 'house', name: 'House', rows: ['..#..', '.###.', '#####', '#.#.#', '#####'] },
  { id: 'cup', name: 'Cup', rows: ['#####', '#...#', '#...#', '.###.', '..#..'] },
  { id: 'letter-t', name: 'Letter T', rows: ['#####', '..#..', '..#..', '..#..', '..#..'] },
  { id: 'smile', name: 'Smile', rows: ['.#.#.', '.#.#.', '.....', '#...#', '.###.'] },
  { id: 'diamond', name: 'Diamond', rows: ['..#..', '.###.', '#####', '.###.', '..#..'] },
  { id: 'boat', name: 'Boat', rows: ['..#..', '.##..', '#####', '.###.', '.....'] },
  { id: 'stairs', name: 'Stairs', rows: ['#....', '##...', '###..', '####.', '#####'] },
]

export const NONOGRAM_PUZZLES: readonly Puzzle[] = NONOGRAM_DEFS.map(toPuzzle)
