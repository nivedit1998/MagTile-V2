// Service worker registration and update lifecycle (production builds only).
// A new worker waits; the Arcade menu offers "Update now". Never swaps code mid-round.

import { useSyncExternalStore } from 'react'

export interface OfflineStatus {
  /** Worker active and controlling this page: the shell is cached for offline launch. */
  ready: boolean
  /** A newer shell is installed and waiting for the user's go-ahead. */
  updateWaiting: boolean
  /** Another tab applied an update; this tab still runs the old code and should reload. */
  stale: boolean
}

let status: OfflineStatus = { ready: false, updateWaiting: false, stale: false }
let registration: ServiceWorkerRegistration | null = null
let reloadOnChange = false
const listeners = new Set<() => void>()

function set(next: Partial<OfflineStatus>) {
  status = { ...status, ...next }
  listeners.forEach((l) => l())
}

function watch(reg: ServiceWorkerRegistration) {
  const check = () => {
    if (reg.waiting && navigator.serviceWorker.controller) set({ updateWaiting: true })
    if (reg.active && navigator.serviceWorker.controller) set({ ready: true })
  }
  check()
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing
    worker?.addEventListener('statechange', check)
  })
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const hadController = !!navigator.serviceWorker.controller
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        registration = reg
        watch(reg)
      })
      .catch(() => {
        /* offline launch is a bonus; the app still works online without it */
      })
  })
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadOnChange) {
      window.location.reload()
      return
    }
    // A controller change we did not ask for, on a page that already had a controller, means
    // another tab applied an update: this tab's lazy chunks may be gone.
    if (hadController) set({ stale: true })
    else set({ ready: true })
  })
}

/** Called only from the Arcade menu, after games have saved. */
export function applyUpdate(): void {
  const waiting = registration?.waiting
  if (!waiting) return
  reloadOnChange = true
  waiting.postMessage('SKIP_WAITING')
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useOfflineStatus(): OfflineStatus {
  return useSyncExternalStore(subscribe, () => status)
}
