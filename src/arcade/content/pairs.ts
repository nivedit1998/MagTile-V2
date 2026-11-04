// Original related word pairs for Undercover. Which word the civilians get is chosen at random
// each round. Plain words only (no brands, no third-party lists). Bump PAIRS_VERSION when the list
// changes, because a saved game stores its two words but a fresh game draws from this list.

export const PAIRS_VERSION = 1

export const WORD_PAIRS: readonly (readonly [string, string])[] = [
  ['Coffee', 'Tea'], ['Guitar', 'Violin'], ['Beach', 'Pool'], ['Bus', 'Train'], ['Pizza', 'Burger'],
  ['Piano', 'Organ'], ['Football', 'Rugby'], ['River', 'Lake'], ['Chair', 'Stool'], ['Pen', 'Pencil'],
  ['Cinema', 'Theatre'], ['Bread', 'Cake'], ['Rain', 'Snow'], ['Doctor', 'Nurse'], ['Apple', 'Pear'],
  ['Shirt', 'Jacket'], ['Lion', 'Tiger'], ['Mountain', 'Hill'], ['Phone', 'Tablet'], ['Bicycle', 'Scooter'],
  ['Spoon', 'Fork'], ['Candle', 'Lamp'], ['Ocean', 'Sea'], ['Castle', 'Palace'], ['Butter', 'Margarine'],
  ['Shoes', 'Sandals'], ['Window', 'Door'], ['Teacher', 'Professor'], ['Pillow', 'Cushion'], ['Soup', 'Stew'],
]

export function validatePairs(list: readonly (readonly [string, string])[]): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const [a, b] of list) {
    if (!a.trim() || !b.trim()) problems.push(`empty word in ${a}/${b}`)
    if (a.toLowerCase() === b.toLowerCase()) problems.push(`identical pair ${a}`)
    if (a.length > 14 || b.length > 14) problems.push(`word too long in ${a}/${b}`)
    for (const w of [a, b]) {
      if (seen.has(w.toLowerCase())) problems.push(`word reused across pairs: ${w}`)
      seen.add(w.toLowerCase())
    }
  }
  return problems
}
