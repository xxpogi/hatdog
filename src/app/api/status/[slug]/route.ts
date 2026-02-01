import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { subDays } from 'date-fns'

export const runtime = 'edge'

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const { slug } = params

    // Find project by public slug
    const project = await prisma.project.findUnique({
      where: { publicSlug: slug },
      include: {
        team: {
          select: { name: true, avatarUrl: true },
        },
        monitors: {
          where: {
            deletedAt: null,
            isEnabled: true,
          },
          include: {
            regions: {
              where: { isEnabled: true },
            },
            sloDefinitions: {
              where: { isEnabled: true },
              include: {
                windows: {
                  orderBy: { windowEnd: 'desc' },
                  take: 1,
                },
              },
            },
          },
        },
      },
    })

    if (!project || !project.isPublic) {
      return NextResponse.json(
        { error: 'Status page not found' },
        { status: 404 }
      )
    }

    // Get current status for each monitor
    const monitorsWithStatus = await Promise.all(
      project.monitors.map(async (monitor) => {
        // Get latest check
        const latestCheck = await prisma.monitorCheck.findFirst({
          where: { monitorId: monitor.id },
          orderBy: { timestamp: 'desc' },
          include: { region: true },
        })

        // Get 24h uptime
        const last24h = subDays(new Date(), 1)
        const checks24h = await prisma.monitorCheck.groupBy({
          by: ['status'],
          where: {
            monitorId: monitor.id,
            timestamp: { gte: last24h },
          },
          _count: { status: true },
        })

        const upCount = checks24h.find(c => c.status === 'UP')?._count.status || 0
        const totalCount = checks24h.reduce((sum, c) => sum + c._count.status, 0)
        const uptime24h = totalCount > 0 ? (upCount / totalCount) * 100 : 100

        // Get 7d and 30d uptime
        const last7d = subDays(new Date(), 7)
        const checks7d = await prisma.monitorCheck.groupBy({
          by: ['status'],
          where: {
            monitorId: monitor.id,
            timestamp: { gte: last7d },
          },
          _count: { status: true },
        })
        const up7d = checks7d.find(c => c.status === 'UP')?._count.status || 0
        const total7d = checks7d.reduce((sum, c) => sum + c._count.status, 0)
        const uptime7d = total7d > 0 ? (up7d / total7d) * 100 : 100

        const last30d = subDays(new Date(), 30)
        const checks30d = await prisma.monitorCheck.groupBy({
          by: ['status'],
          where: {
            monitorId: monitor.id,
            timestamp: { gte: last30d },
          },
          _count: { status: true },
        })
        const up30d = checks30d.find(c => c.status === 'UP')?._count.status || 0
        const total30d = checks30d.reduce((sum, c) => sum + c._count.status, 0)
        const uptime30d = total30d > 0 ? (up30d / total30d) * 100 : 100

        // Get region status
        const regionStatus = await Promise.all(
          monitor.regions.map(async (region) => {
            const latestRegionCheck = await prisma.monitorCheck.findFirst({
              where: { regionId: region.id },
              orderBy: { timestamp: 'desc' },
            })

            return {
              region: region.region,
              status: latestRegionCheck?.status || 'UNKNOWN',
              responseTime: latestRegionCheck?.responseTime || 0,
            }
          })
        )

        return {
          id: monitor.id,
          name: monitor.name,
          url: monitor.url,
          status: latestCheck?.status || 'UP',
          responseTime: latestCheck?.responseTime || 0,
          lastChecked: latestCheck?.timestamp || null,
          uptime: {
            '24h': Math.round(uptime24h * 100) / 100,
            '7d': Math.round(uptime7d * 100) / 100,
            '30d': Math.round(uptime30d * 100) / 100,
          },
          regions: regionStatus,
          slos: monitor.sloDefinitions.map(slo => ({
            name: slo.name,
            target: slo.target,
            achieved: slo.windows[0]?.achieved || slo.target,
            isBreached: slo.windows[0]?.isBreached || false,
          })),
        }
      })
    )

    // Get recent incidents
    const last30d = subDays(new Date(), 30)
    const incidents = await prisma.incident.findMany({
      where: {
        monitor: { projectId: project.id },
        startedAt: { gte: last30d },
      },
      include: {
        monitor: {
          select: { name: true },
        },
      },
      orderBy: { startedAt: 'desc' },
      take: 10,
    })

    const incidentsFormatted = incidents.map(incident => ({
      id: incident.id,
      title: incident.title,
      monitor: incident.monitor.name,
      severity: incident.severity,
      category: incident.category,
      startedAt: incident.startedAt,
      resolvedAt: incident.resolvedAt,
      duration: incident.duration,
      description: incident.description,
    }))

    // Calculate overall status
    const allUp = monitorsWithStatus.every(m => m.status === 'UP')
    const hasIssues = monitorsWithStatus.some(m => m.status === 'DEGRADED')
    const hasOutages = monitorsWithStatus.some(m => m.status === 'DOWN' || m.status === 'TIMEOUT')

    let overallStatus = 'operational'
    if (hasOutages) overallStatus = 'major-outage'
    else if (hasIssues) overallStatus = 'degraded'

    return NextResponse.json({
      project: {
        name: project.name,
        description: project.description,
        team: project.team.name,
      },
      status: overallStatus,
      monitors: monitorsWithStatus,
      incidents: incidentsFormatted,
      lastUpdated: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Status page error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
