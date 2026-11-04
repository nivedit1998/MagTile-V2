import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavSlot } from './navSlot'

interface GameBarProps {
  title: string
  backLabel: string
  onBack: () => void
  rightLabel?: string
  onRight?: () => void
}

/**
 * A game has no header of its own: the whole screen below the persistent navigation bar belongs to the game.
 * Its back/menu controls are placed inside that navigation bar instead.
 */
export function GameBar({ title, backLabel, onBack, rightLabel, onRight }: GameBarProps) {
  const slot = useNavSlot()
  if (!slot) return null
  return createPortal(
    <div className="nav-actions" role="group" aria-label={title}>
      <button type="button" className="nav-action" onClick={onBack}>{backLabel}</button>
      {rightLabel && onRight ? (
        <button type="button" className="nav-action" onClick={onRight}>{rightLabel}</button>
      ) : null}
    </div>,
    slot,
  )
}

interface ComingSoonProps {
  name: string
  onBack: () => void
}

export function ComingSoon({ name, onBack }: ComingSoonProps) {
  return (
    <div className="arc-game">
      <GameBar title={name} backLabel="‹ ARCADE" onBack={onBack} />
      <div className="arc-body arc-center">
        <p className="arc-lead">Not built yet</p>
        <p className="arc-text">{name} arrives in a later phase.</p>
        <button type="button" className="arc-btn arc-primary" onClick={onBack}>Back to Arcade</button>
      </div>
    </div>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="arc-notice" role="status">{children}</p>
}
