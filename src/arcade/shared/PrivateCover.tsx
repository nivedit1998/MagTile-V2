import { useState } from 'react'
import { type Ballot, allowedTargets, counts, currentVoter } from './voting'
import { usePrivacy } from './usePrivacy'

interface CoverProps {
  kicker?: string
  title: string
  text: string
  button: string
  onReveal: () => void
}

/** Neutral hand-off screen: shows no secret until the right person taps. */
export function PrivateCover({ kicker, title, text, button, onReveal }: CoverProps) {
  return (
    <div className="arc-body arc-center">
      {kicker ? <p className="arc-kicker">{kicker}</p> : null}
      <p className="arc-big">{title}</p>
      <p className="arc-text">{text}</p>
      <button type="button" className="arc-btn arc-primary" autoFocus onClick={onReveal}>{button}</button>
    </div>
  )
}

interface BallotProps {
  names: readonly string[]
  ballot: Ballot
  /** Unique per ballot and game, e.g. "uc-3". */
  scope: string
  /** Extra line above the options (e.g. a runoff explanation). */
  note?: string
  onCast: (target: number) => void
}

/**
 * One secret vote at a time. The voter sees the cover first, then picks a target and locks the vote;
 * the next voter starts covered again. Choices are never shown; only the tally after the last vote.
 */
export function BallotView({ names, ballot, scope, note, onCast }: BallotProps) {
  const voter = currentVoter(ballot)
  const key = voter === null ? null : `${scope}-${ballot.round}-${ballot.cursor}`
  const { covered, reveal, hide } = usePrivacy(key)
  const [pick, setPick] = useState<{ key: string; target: number } | null>(null)
  if (voter === null) return null
  const chosen = pick && pick.key === key ? pick.target : null
  const targets = allowedTargets(ballot)

  if (covered) {
    return (
      <PrivateCover
        kicker={`${ballot.round === 2 ? 'RUNOFF · ' : ''}VOTE ${ballot.cursor + 1} OF ${ballot.voters.length}`}
        title={`Pass to ${names[voter]}`}
        text={`Only ${names[voter]} should look at the screen. Your vote stays secret.`}
        button={`I’m ${names[voter]}. Show ballot`}
        onReveal={reveal}
      />
    )
  }
  return (
    <div className="arc-body">
      <p className="arc-kicker">{names[voter].toUpperCase()} · SECRET VOTE</p>
      <p className="arc-text">{note ?? 'Who should be eliminated? You cannot vote for yourself.'}</p>
      <div className="vote-list" role="group" aria-label="Vote for" data-page-jump={1}>
        {targets.map((t) => (
          <button key={t} type="button" aria-pressed={chosen === t} className={`vote-option${chosen === t ? ' on' : ''}`} onClick={() => setPick({ key: key!, target: t })}>
            {chosen === t ? '✓ ' : ''}{names[t]}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="arc-btn arc-primary"
        disabled={chosen === null}
        onClick={() => {
          if (chosen === null) return
          hide()
          setPick(null)
          onCast(chosen)
        }}
      >
        Lock vote and hide
      </button>
    </div>
  )
}

interface TallyProps {
  names: readonly string[]
  ballot: Ballot
}

/** The public result of a completed ballot: how many votes each candidate received (not who voted for whom). */
export function TallyList({ names, ballot }: TallyProps) {
  const m = counts(ballot)
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  return (
    <ul className="card-list" aria-label="Votes received">
      {rows.map(([p, n]) => (
        <li key={p}><b>{n}</b> {names[p]}</li>
      ))}
    </ul>
  )
}
