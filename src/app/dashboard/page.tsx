import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getUserTeams } from '@/app/_actions/team.actions'
import { DashboardShell } from '@/app/_components/dashboard-shell'
import { OverviewStatsContainer } from '@/app/_components/overview-stats-container'
import { MonitorsList } from '@/app/_components/monitors-list'
import { RecentIncidents } from '@/app/_components/recent-incidents'
import { TeamSelector } from '@/app/_components/team-selector'

export default async function DashboardPage() {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  const teams = await getUserTeams()
  const defaultTeam = teams[0]

  if (!defaultTeam) {
    return (
      <DashboardShell user={user}>
        <div className="flex flex-col items-center justify-center h-[60vh]">
          <h2 className="text-2xl font-semibold mb-2">Welcome to Observability Platform</h2>
          <p className="text-muted-foreground mb-6">
            You don&apos;t have any teams yet. Create one to get started.
          </p>
          <a
            href="/teams/new"
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
          >
            Create Team
          </a>
        </div>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell user={user} teams={teams} currentTeam={defaultTeam}>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground">
              Overview of your monitoring infrastructure
            </p>
          </div>
          <TeamSelector teams={teams} currentTeam={defaultTeam} />
        </div>

        {/* Stats Overview */}
        <OverviewStatsContainer teamId={defaultTeam.id} />

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Monitors List */}
          <div className="lg:col-span-2">
            <MonitorsList teamId={defaultTeam.id} />
          </div>

          {/* Recent Incidents */}
          <div>
            <RecentIncidents teamId={defaultTeam.id} />
          </div>
        </div>
      </div>
    </DashboardShell>
  )
}
