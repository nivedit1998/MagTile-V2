import { useCallback, useEffect, useRef, useState } from 'react'
import { readSave, removeSave, writeSave } from '../storage/saves'

export type SavedGame<S, T> =
  | { kind: 'none' }
  | { kind: 'ok'; settings: S; state: T }
  | { kind: 'bad'; reason: string }

/**
 * One resumable local session per game. `parse` must strictly validate stored data and
 * return null when anything is inconsistent. `warning` is true after a write that only
 * reached memory (storage unavailable or full).
 */
export function useGameSave<S, T>(
  gameId: string,
  gameVersion: number,
  parse: (settings: unknown, state: unknown) => { settings: S; state: T } | null,
) {
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState<SavedGame<S, T>>({ kind: 'none' })
  const [warning, setWarning] = useState(false)
  const session = useRef('')
  const parseRef = useRef(parse)
  parseRef.current = parse

  useEffect(() => {
    let live = true
    readSave(gameId, gameVersion).then((read) => {
      if (!live) return
      if (read.kind === 'none') setSaved({ kind: 'none' })
      else if (read.kind === 'bad') setSaved({ kind: 'bad', reason: read.reason })
      else {
        const parsed = parseRef.current(read.envelope.settings, read.envelope.state)
        setSaved(parsed ? { kind: 'ok', ...parsed } : { kind: 'bad', reason: 'The saved game is damaged.' })
      }
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [gameId, gameVersion])

  const save = useCallback(
    async (settings: S, state: T, newSession = false) => {
      if (newSession || !session.current) session.current = crypto.randomUUID()
      const ok = await writeSave({
        schemaVersion: 1,
        gameId,
        gameVersion,
        sessionId: session.current,
        updatedAt: Date.now(),
        settings,
        state,
      })
      setWarning(!ok)
    },
    [gameId, gameVersion],
  )

  const clear = useCallback(async () => {
    await removeSave(gameId)
    setSaved({ kind: 'none' })
  }, [gameId])

  return { loading, saved, warning, save, clear }
}
