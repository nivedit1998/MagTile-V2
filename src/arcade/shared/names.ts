// Pure name-list validation shared by the pass-and-play games.

export const MAX_NAME_LENGTH = 14

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

export interface NameListCheck {
  ok: boolean
  names: string[]
  errors: (string | null)[]
}

/** Cleaned, distinct (case-insensitive), 1-14 character names; `min`..`max` entries. */
export function validateNameList(raw: readonly string[], min: number, max: number): NameListCheck {
  const names = raw.map(clean)
  const errors: (string | null)[] = names.map((n) => {
    if (n.length === 0) return 'Enter a name.'
    if (n.length > MAX_NAME_LENGTH) return `Use ${MAX_NAME_LENGTH} characters or fewer.`
    if (CONTROL.test(n)) return 'Remove special characters.'
    return null
  })
  names.forEach((n, i) => {
    if (errors[i] === null && names.findIndex((m) => m.toLowerCase() === n.toLowerCase()) !== i) errors[i] = 'Names must be different.'
  })
  if (names.length < min || names.length > max) {
    return { ok: false, names, errors: errors.map((e) => e ?? `Use ${min} to ${max} players.`) }
  }
  return { ok: errors.every((e) => e === null), names, errors }
}

/** True if the stored names are already in cleaned, valid form. */
export function namesAreClean(names: unknown, min: number, max: number): names is string[] {
  if (!Array.isArray(names) || !names.every((n) => typeof n === 'string')) return false
  const check = validateNameList(names as string[], min, max)
  return check.ok && check.names.every((n, i) => n === names[i])
}
