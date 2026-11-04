import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Leaves the failed screen (back to the Arcade list). */
  onBack: () => void
}

/**
 * Catches a failed lazy game chunk (for example after the app updated in another tab and the
 * old chunk is gone) so the simulator never goes blank. Saves are untouched.
 */
export class GameErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="arc-game">
        <div className="arc-body arc-center">
          <p className="arc-lead">This game couldn’t load</p>
          <p className="arc-text">The app may have been updated. Your saved games are safe. Reload to continue.</p>
          <button type="button" className="arc-btn arc-primary" onClick={() => window.location.reload()}>Reload</button>
          <button type="button" className="arc-btn" onClick={this.props.onBack}>Back to Arcade</button>
        </div>
      </div>
    )
  }
}
