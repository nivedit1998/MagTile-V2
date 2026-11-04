import { useMemo } from 'react'
import { useContent } from '../../content/runtime'
import { GameBar } from '../../shared/GameFrame'
import TeamRoundScreen, { type TeamGameConfig } from '../../shared/TeamRoundScreen'

const RULES =
  'Teams take turns. The actor silently acts out as many cards as possible before the clock runs out; the team guesses. Correct is +1, Pass is 0. Film and show cards show the year and language. No card repeats until every card in the chosen categories has been used.'

/** Opens with one snapshot of the content (starter set or the installed charades pack) for the whole session. */
export default function CharadesScreen({ onExit }: { onExit: () => void }) {
  const content = useContent()
  const config = useMemo<TeamGameConfig | null>(
    () =>
      content
        ? { gameId: 'charades', title: 'Charades', version: content.charades.version, categories: content.charades.categories, holder: 'the actor', defaultCategories: ['actions', 'hollywood', 'bollywood'], rules: RULES }
        : null,
    [content],
  )
  if (!config) {
    return (
      <div className="arc-game">
        <GameBar title="Charades" backLabel="‹ ARCADE" onBack={onExit} />
        <div className="arc-body arc-center"><p className="arc-text">Loading…</p></div>
      </div>
    )
  }
  return <TeamRoundScreen config={config} onExit={onExit} />
}
