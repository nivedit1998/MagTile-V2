import { useEffect, useState } from 'react'

/**
 * Wall-clock "now" for a visible countdown. It only runs while `active` (a timed round is in
 * progress): one update per second, plus an immediate refresh when the page becomes visible
 * again, so time that passed while hidden or asleep shows up at once. Idle screens tick nothing.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    const onVisible = () => {
      if (!document.hidden) setNow(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active])
  return now
}
