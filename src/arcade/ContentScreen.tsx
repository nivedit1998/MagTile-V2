import { useState } from 'react'
import { type ContentSet, useContent } from './content/runtime'
import { type SyncOutcome, manifestUrl, runSync } from './content/sync'
import { GameBar } from './shared/GameFrame'

const PACKS = [
  { key: 'trivia', label: 'Trivia questions', count: (c: ContentSet) => c.trivia.categories.reduce((n, x) => n + x.questions.length, 0), cats: (c: ContentSet) => c.trivia.categories.length, src: (c: ContentSet) => c.trivia },
  { key: 'words', label: 'Words (Hangman, Word Rush)', count: (c: ContentSet) => c.words.categories.reduce((n, x) => n + x.cards.length, 0), cats: (c: ContentSet) => c.words.categories.length, src: (c: ContentSet) => c.words },
  { key: 'charades', label: 'Charades cards', count: (c: ContentSet) => c.charades.categories.reduce((n, x) => n + x.cards.length, 0), cats: (c: ContentSet) => c.charades.categories.length, src: (c: ContentSet) => c.charades },
] as const

const when = (t: number | null) => (t === null ? 'never' : new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))

function describe(o: SyncOutcome): string {
  switch (o.result) {
    case 'updated': return `Updated: ${o.updated.join(', ')}. New content is used the next time you open a game.`
    case 'unchanged': return 'Already up to date. Nothing was downloaded.'
    case 'deferred': return `A newer ${o.deferred.join(', ')} pack is waiting. Finish or abandon your saved match, then refresh again.`
    case 'no-content': return 'No online content has been published yet. Using the built-in starter set.'
    case 'offline': return 'You are offline. Using saved packs.'
    case 'unconfigured': return 'This build has no content source. Using the built-in starter set.'
    case 'throttled': return `Refresh is limited to once every 15 minutes. Try again in ${Math.max(1, Math.ceil((o.waitMs ?? 0) / 60000))} min.`
    case 'busy': return 'Another tab is already checking.'
    case 'skipped': return 'Checked recently. Using saved packs.'
    default: return `Could not update (${o.detail ?? 'unknown error'}). Using saved packs.`
  }
}

interface Props {
  onBack: () => void
}

/** Where the question, word and card packs come from, when they were last refreshed, and their credits. */
export default function ContentScreen({ onBack }: Props) {
  const content = useContent(true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const configured = manifestUrl() !== null

  const refresh = () => {
    setBusy(true)
    setNote(null)
    runSync('manual')
      .then((o) => setNote(describe(o)))
      .finally(() => setBusy(false))
  }

  if (!content) {
    return (
      <div className="arc-game">
        <GameBar title="Content" backLabel="‹ ARCADE" onBack={onBack} />
        <div className="arc-body arc-center"><p className="arc-text">Loading…</p></div>
      </div>
    )
  }

  const credits = new Map<string, { source: string; licence: string; attribution: string; url?: string }>()
  for (const p of PACKS) for (const c of p.src(content).credits) credits.set(`${c.source}|${c.licence}`, c)
  const downloaded = PACKS.filter((p) => p.src(content).origin === 'downloaded').length

  return (
    <div className="arc-game">
      <GameBar title="Content" backLabel="‹ ARCADE" onBack={onBack} />
      <div className="arc-body">
        <p className="arc-lead">Content &amp; credits</p>
        <p className="arc-text arc-rules">Games never use the network while you play. Packs refresh at most once a day from this menu.</p>

        <ul className="card-list" aria-label="Installed content">
          {PACKS.map((p) => {
            const s = p.src(content)
            return (
              <li key={p.key}>
                <strong>{p.label}</strong>
                <br />
                {p.count(content)} items · {p.cats(content)} categories · {s.origin === 'starter' ? 'starter set' : `v${s.version}`}
              </li>
            )
          })}
        </ul>

        <p className="arc-text">
          Last check: <strong>{when(content.meta.lastSuccess)}</strong>. {downloaded === 0 ? 'Using the built-in starter set.' : 'Using saved packs.'}
          {content.meta.lastResult === 'failed' ? ` Last attempt failed${content.meta.lastDetail ? `: ${content.meta.lastDetail.replace(/\.$/, '')}` : ''}.` : ''}
          {content.meta.deferred.length ? ` Waiting to install: ${content.meta.deferred.join(', ')}.` : ''}
        </p>
        {content.damaged.length ? <p className="arc-notice" role="alert">A saved pack ({content.damaged.join(', ')}) was damaged and is ignored. The starter set is used instead.</p> : null}

        {configured ? (
          <button type="button" className="arc-btn arc-primary" disabled={busy} onClick={refresh}>{busy ? 'Checking…' : 'Check for new content'}</button>
        ) : (
          <p className="arc-text arc-rules">Online content updates are not set up in this build.</p>
        )}
        {note ? <p className="tv-result" role="status">{note}</p> : null}

        <p className="arc-kicker">CREDITS</p>
        <ul className="card-list" aria-label="Credits">
          {[...credits.values()].map((c) => (
            <li key={`${c.source}|${c.licence}`}><strong>{c.source}</strong> · {c.licence}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
