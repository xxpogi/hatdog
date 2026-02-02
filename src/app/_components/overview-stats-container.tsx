import { getOverviewStats } from '@/app/_actions/overview.actions'
import { OverviewStats } from '@/app/_components/overview-stats'

interface OverviewStatsContainerProps {
  teamId: string
}

export async function OverviewStatsContainer({ teamId }: OverviewStatsContainerProps) {
  const stats = await getOverviewStats(teamId)

  return <OverviewStats stats={stats} />
}
