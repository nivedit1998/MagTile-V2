// Hardware-button adapter. Page buttons are mapped here, never inside game rules.
// The simulator's on-screen page buttons dispatch the same KeyboardEvents as a real keyboard.

export type PageKey = 'PageUp' | 'PageDown'

export function pressHardwareKey(key: PageKey): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex="0"]'

/** Discrete focus step through the visible controls in a container (no animation). */
export function stepFocus(container: HTMLElement, direction: 1 | -1): void {
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null && !el.closest('[inert]'))
  if (items.length === 0) return
  const active = document.activeElement as HTMLElement | null

  // A control grid can opt in to row-sized jumps with data-page-jump="<columns>".
  const group = active?.closest<HTMLElement>('[data-page-jump]')
  if (group && container.contains(group)) {
    const jump = Number(group.dataset.pageJump) || 1
    // Positions use every cell (disabled ones included) so a jump stays in the same column.
    const all = Array.from(group.querySelectorAll<HTMLElement>('button'))
    const pos = all.indexOf(active as HTMLElement)
    if (pos !== -1) {
      for (let to = pos + direction * jump; to >= 0 && to < all.length; to += direction * jump) {
        if (items.includes(all[to])) {
          all[to].focus()
          return
        }
      }
      // Past the grid edge: continue with the control just outside it.
      const inside = items.filter((el) => group.contains(el))
      const edge = items.indexOf(direction === 1 ? inside[inside.length - 1] : inside[0])
      items[(edge + direction + items.length) % items.length].focus()
      return
    }
  }

  const at = items.indexOf(active as HTMLElement)
  const next = at === -1 ? (direction === 1 ? 0 : items.length - 1) : (at + direction + items.length) % items.length
  items[next].focus()
}
