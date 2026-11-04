import type { ReactNode } from 'react'

interface GameBarProps {
  title: string
  backLabel: string
  onBack: () => void
  rightLabel?: string
  onRight?: () => void
}

/** Thin top bar shared by every game: back/exit on the left, optional menu on the right. */
export function GameBar({ title, backLabel, onBack, rightLabel, onRight }: GameBarProps) {
  return (
    <div className="arc-bar">
      <button type="button" onClick={onBack}>{backLabel}</button>
      <h2>{title}</h2>
      {rightLabel && onRight ? (
        <button type="button" className="arc-bar-right" onClick={onRight}>{rightLabel}</button>
      ) : null}
    </div>
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
        <p className="arc-text">{name} arrives in a later phase. Tic-Tac-Toe is playable now.</p>
        <button type="button" className="arc-btn arc-primary" onClick={onBack}>Back to Arcade</button>
      </div>
    </div>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="arc-notice" role="status">{children}</p>
}
