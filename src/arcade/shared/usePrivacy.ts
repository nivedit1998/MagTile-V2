import { useCallback, useEffect, useState } from 'react'

/**
 * Privacy cover for secret screens on a shared device.
 *
 * `stepKey` identifies the secret step on screen (for example "reveal-3" or "vote-1-2"). The step is
 * only visible after an explicit `reveal()` FOR THAT KEY, so a new step always starts covered (no
 * flash of the next person's secret). The cover returns whenever the page is hidden, the window
 * loses focus, or the page is restored from the back/forward cache, so resuming never shows an old
 * secret. Shared-device privacy protects normal hand-offs, not someone with devtools or storage access.
 * Pass `null` when the current screen holds no secret.
 */
export function usePrivacy(stepKey: string | null) {
  const [revealed, setRevealed] = useState<string | null>(null)

  useEffect(() => {
    const hide = () => setRevealed(null)
    const onVisibility = () => {
      if (document.hidden) hide()
    }
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) hide()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', hide)
    window.addEventListener('pagehide', hide)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', hide)
      window.removeEventListener('pagehide', hide)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  const reveal = useCallback(() => setRevealed(stepKey), [stepKey])
  const hide = useCallback(() => setRevealed(null), [])
  return { covered: stepKey === null ? false : revealed !== stepKey, reveal, hide }
}
