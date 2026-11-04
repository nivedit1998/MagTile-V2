import { useMemo } from 'react'
import { useContent } from '../../content/runtime'
import { GameBar } from '../../shared/GameFrame'
import TeamRoundScreen, { type TeamGameConfig } from '../../shared/TeamRoundScreen'

const RULES =
  'Teams take turns. The describer gets as many words across as possible before the clock runs out: describe each word without saying it. Correct is +1, Pass is 0. No word repeats until every card in the chosen categories has been used.'

/** Opens with one snapshot of the content (starter set or the installed words pack) for the whole session. */
export default function WordRushScreen({ onExit }: { onExit: () => void }) {
  const content = useContent()
  const config = useMemo<TeamGameConfig | null>(
    () =>
      content
        ? { gameId: 'wordrush', title: 'Word Rush', version: content.words.version, categories: content.words.categories, holder: 'the describer', defaultCategories: ['animals', 'food'], rules: RULES }
        : null,
    [content],
  )
  if (!config) {
    return (
      <div className="arc-game">
        <GameBar title="Word Rush" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body arc-center"><p className="arc-text">Loading…</p></div>
      </div>
    )
  }
  return <TeamRoundScreen config={config} onExit={onExit} />
}
