'use server'

import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { requirePermission, checkPermission } from '@/lib/rbac'
import { createMonitorSchema, updateMonitorSchema } from '@/lib/validators'
import { revalidatePath } from 'next/cache'
import { startOfDay, subDays } from 'date-fns'

export async function getMonitors(projectId: string) {
  const user = await requireAuth()

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { team: { include: { members: true } } },
  })

  if (!project) return []

  const isMember = project.team.members.some(m => m.userId === user.id)
  if (!isMember) return []

  const monitors = await prisma.monitor.findMany({
    where: {
      projectId,
      deletedAt: null,
    },
    include: {
      regions: true,
      _count: {
        select: { checks: true, incidents: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Get latest check status for each monitor
  const monitorsWithStatus = await Promise.all(
    monitors.map(async (monitor) => {
      const latestCheck = await prisma.monitorCheck.findFirst({
        where: { monitorId: monitor.id },
        orderBy: { timestamp: 'desc' },
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

      return {
        ...monitor,
        latestStatus: latestCheck?.status || 'UP',
        latestResponseTime: latestCheck?.responseTime || 0,
        uptime24h: Math.round(uptime24h * 100) / 100,
      }
    })
  )

  return monitorsWithStatus
}

export async function getMonitorById(monitorId: string) {
  const user = await requireAuth()

  const monitor = await prisma.monitor.findUnique({
    where: { id: monitorId },
    include: {
      project: {
        include: {
          team: { include: { members: true } },
        },
      },
      regions: true,
    },
  })

  if (!monitor || monitor.deletedAt) return null

  const isMember = monitor.project.team.members.some(m => m.userId === user.id)
  if (!isMember) return null

  return monitor
}

export async function getMonitorStats(monitorId: string, days: number = 7) {
  const user = await requireAuth()

  const monitor = await prisma.monitor.findUnique({
    where: { id: monitorId },
    include: {
      project: {
        include: {
          team: { include: { members: true } },
        },
      },
    },
  })

  if (!monitor) return null

  const isMember = monitor.project.team.members.some(m => m.userId === user.id)
  if (!isMember) return null

  const startDate = subDays(new Date(), days)

  // Get all checks in the period
  const checks = await prisma.monitorCheck.findMany({
    where: {
      monitorId,
      timestamp: { gte: startDate },
    },
    orderBy: { timestamp: 'asc' },
  })

  // Calculate uptime
  const upCount = checks.filter(c => c.status === 'UP').length
  const totalCount = checks.length
  const uptime = totalCount > 0 ? (upCount / totalCount) * 100 : 100

  // Calculate latency percentiles
  const responseTimes = checks
    .filter(c => c.status === 'UP' && c.responseTime)
    .map(c => c.responseTime)
    .sort((a, b) => a! - b!)

  const p50 = responseTimes[Math.floor(responseTimes.length * 0.5)] || 0
  const p95 = responseTimes[Math.floor(responseTimes.length * 0.95)] || 0
  const p99 = responseTimes[Math.floor(responseTimes.length * 0.99)] || 0

  // Get incidents
  const incidents = await prisma.incident.findMany({
    where: {
      monitorId,
      startedAt: { gte: startDate },
    },
    orderBy: { startedAt: 'desc' },
  })

  // Daily breakdown
  const dailyStats: Record<string, { up: number; down: number; avgLatency: number }> = {}
  
  checks.forEach(check => {
    const day = startOfDay(check.timestamp).toISOString()
    if (!dailyStats[day]) {
      dailyStats[day] = { up: 0, down: 0, avgLatency: 0 }
    }
    if (check.status === 'UP') {
      dailyStats[day].up++
      dailyStats[day].avgLatency += check.responseTime || 0
    } else {
      dailyStats[day].down++
    }
  })

  const daily = Object.entries(dailyStats).map(([date, stats]) => ({
    date,
    uptime: stats.up + stats.down > 0 ? (stats.up / (stats.up + stats.down)) * 100 : 100,
    avgLatency: stats.up > 0 ? Math.round(stats.avgLatency / stats.up) : 0,
  }))

  return {
    uptime: Math.round(uptime * 100) / 100,
    totalChecks: totalCount,
    p50,
    p95,
    p99,
    incidents,
    daily,
  }
}

export async function createMonitor(projectId: string, formData: FormData) {
  try {
    const user = await requireAuth()

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { team: true },
    })

    if (!project) {
      return { error: 'Project not found' }
    }

    await requirePermission(user.id, project.teamId, 'monitor:create')

    const data = {
      name: formData.get('name') as string,
      url: formData.get('url') as string,
      type: formData.get('type') as any,
      method: formData.get('method') as any,
      interval: parseInt(formData.get('interval') as string),
      timeout: parseInt(formData.get('timeout') as string),
      expectedStatus: formData.get('expectedStatus')
        ? parseInt(formData.get('expectedStatus') as string)
        : undefined,
      regions: JSON.parse(formData.get('regions') as string || '[]'),
    }

    const validated = createMonitorSchema.parse(data)

    const monitor = await prisma.monitor.create({
      data: {
        name: validated.name,
        url: validated.url,
        type: validated.type,
        method: validated.method,
        interval: validated.interval,
        timeout: validated.timeout,
        expectedStatus: validated.expectedStatus,
        projectId,
        regions: {
          create: validated.regions.map(region => ({
            region,
            isEnabled: true,
          })),
        },
      },
      include: { regions: true },
    })

    revalidatePath(`/projects/${projectId}/monitors`)
    return { success: true, monitor }
  } catch (error) {
    console.error('Create monitor error:', error)
    return { error: 'Failed to create monitor' }
  }
}

export async function updateMonitor(monitorId: string, formData: FormData) {
  try {
    const user = await requireAuth()

    const monitor = await prisma.monitor.findUnique({
      where: { id: monitorId },
      include: {
        project: { include: { team: true } },
      },
    })

    if (!monitor || monitor.deletedAt) {
      return { error: 'Monitor not found' }
    }

    await requirePermission(user.id, monitor.project.teamId, 'monitor:update')

    const name = formData.get('name') as string | undefined
    const url = formData.get('url') as string | undefined
    const interval = formData.get('interval')
      ? parseInt(formData.get('interval') as string)
      : undefined
    const timeout = formData.get('timeout')
      ? parseInt(formData.get('timeout') as string)
      : undefined
    const isEnabled = formData.has('isEnabled') 
      ? formData.get('isEnabled') === 'true'
      : undefined

    const updateData: any = {}
    if (name !== undefined) updateData.name = name
    if (url !== undefined) updateData.url = url
    if (interval !== undefined) updateData.interval = interval
    if (timeout !== undefined) updateData.timeout = timeout
    if (isEnabled !== undefined) updateData.isEnabled = isEnabled

    const updated = await prisma.monitor.update({
      where: { id: monitorId },
      data: updateData,
    })

    revalidatePath(`/monitors/${monitorId}`)
    return { success: true, monitor: updated }
  } catch (error) {
    console.error('Update monitor error:', error)
    return { error: 'Failed to update monitor' }
  }
}

export async function deleteMonitor(monitorId: string) {
  try {
    const user = await requireAuth()

    const monitor = await prisma.monitor.findUnique({
      where: { id: monitorId },
      include: {
        project: { include: { team: true } },
      },
    })

    if (!monitor || monitor.deletedAt) {
      return { error: 'Monitor not found' }
    }

    await requirePermission(user.id, monitor.project.teamId, 'monitor:delete')

    await prisma.monitor.update({
      where: { id: monitorId },
      data: { deletedAt: new Date() },
    })

    revalidatePath(`/projects/${monitor.projectId}/monitors`)
    return { success: true }
  } catch (error) {
    console.error('Delete monitor error:', error)
    return { error: 'Failed to delete monitor' }
  }
}
