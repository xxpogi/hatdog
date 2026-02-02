'use server'

import { prisma } from '@/lib/prisma'
import { subDays } from 'date-fns'
import type { Stats } from '@/app/_components/overview-stats'

export async function getOverviewStats(teamId: string): Promise<Stats> {
  // Get all projects for this team
  const projects = await prisma.project.findMany({
    where: { teamId },
    include: {
      monitors: {
        where: { deletedAt: null, isEnabled: true },
        include: {
          checks: {
            where: {
              timestamp: { gte: subDays(new Date(), 1) },
            },
            orderBy: { timestamp: 'desc' },
            take: 1,
          },
          incidents: {
            where: { resolvedAt: null },
          },
        },
      },
    },
  })

  const allMonitors = projects.flatMap(project => project.monitors)

  // Calculate stats
  const totalMonitors = allMonitors.length
  const upMonitors = allMonitors.filter(monitor => monitor.checks[0]?.status === 'UP').length
  const downMonitors = allMonitors.filter(
    monitor => monitor.checks[0]?.status === 'DOWN' || monitor.checks[0]?.status === 'TIMEOUT'
  ).length

  // Get incidents
  const incidents = await prisma.incident.findMany({
    where: {
      monitor: {
        project: { teamId },
      },
      startedAt: { gte: subDays(new Date(), 30) },
    },
  })

  const totalIncidents = incidents.length
  const openIncidents = incidents.filter(incident => !incident.resolvedAt).length

  // Calculate average uptime
  const uptimeChecks = await prisma.monitorCheck.findMany({
    where: {
      monitor: {
        project: { teamId },
        deletedAt: null,
      },
      timestamp: { gte: subDays(new Date(), 1) },
    },
  })

  const upCount = uptimeChecks.filter(check => check.status === 'UP').length
  const avgUptime = uptimeChecks.length > 0 ? (upCount / uptimeChecks.length) * 100 : 100

  // Calculate average latency
  const latencyChecks = uptimeChecks.filter(check => check.status === 'UP' && check.responseTime)
  const avgLatency =
    latencyChecks.length > 0
      ? latencyChecks.reduce((sum, check) => sum + check.responseTime, 0) / latencyChecks.length
      : 0

  return {
    totalMonitors,
    upMonitors,
    downMonitors,
    totalIncidents,
    openIncidents,
    avgUptime,
    avgLatency,
  }
}
