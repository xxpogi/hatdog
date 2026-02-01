'use server'

import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { requirePermission } from '@/lib/rbac'
import { createSloSchema } from '@/lib/validators'
import { revalidatePath } from 'next/cache'
import { subDays, startOfDay, endOfDay } from 'date-fns'

export async function getSloDefinitions(monitorId: string) {
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

  if (!monitor) return []

  const isMember = monitor.project.team.members.some(m => m.userId === user.id)
  if (!isMember) return []

  const slos = await prisma.sloDefinition.findMany({
    where: { monitorId },
    include: {
      windows: {
        orderBy: { windowEnd: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return slos.map(slo => ({
    ...slo,
    currentWindow: slo.windows[0] || null,
  }))
}

export async function getSloDetails(sloId: string) {
  const user = await requireAuth()

  const slo = await prisma.sloDefinition.findUnique({
    where: { id: sloId },
    include: {
      monitor: {
        include: {
          project: {
            include: {
              team: { include: { members: true } },
            },
          },
        },
      },
      windows: {
        orderBy: { windowEnd: 'desc' },
        take: 30,
      },
    },
  })

  if (!slo) return null

  const isMember = slo.monitor.project.team.members.some(m => m.userId === user.id)
  if (!isMember) return null

  return slo
}

export async function createSloDefinition(monitorId: string, formData: FormData) {
  try {
    const user = await requireAuth()

    const monitor = await prisma.monitor.findUnique({
      where: { id: monitorId },
      include: {
        project: { include: { team: true } },
      },
    })

    if (!monitor) {
      return { error: 'Monitor not found' }
    }

    await requirePermission(user.id, monitor.project.teamId, 'slo:create')

    const name = formData.get('name') as string
    const target = parseFloat(formData.get('target') as string)
    const metricType = formData.get('metricType') as any
    const threshold = parseInt(formData.get('threshold') as string)
    const windowDays = parseInt(formData.get('windowDays') as string)

    const validated = createSloSchema.parse({
      name,
      target,
      metricType,
      threshold,
      windowDays,
    })

    const slo = await prisma.sloDefinition.create({
      data: {
        name: validated.name,
        target: validated.target,
        metricType: validated.metricType,
        threshold: validated.threshold,
        windowDays: validated.windowDays,
        monitorId,
      },
    })

    // Calculate initial window
    await calculateSloWindow(slo.id)

    revalidatePath(`/monitors/${monitorId}/slos`)
    return { success: true, slo }
  } catch (error) {
    console.error('Create SLO error:', error)
    return { error: 'Failed to create SLO definition' }
  }
}

export async function updateSloDefinition(sloId: string, formData: FormData) {
  try {
    const user = await requireAuth()

    const slo = await prisma.sloDefinition.findUnique({
      where: { id: sloId },
      include: {
        monitor: {
          include: {
            project: { include: { team: true } },
          },
        },
      },
    })

    if (!slo) {
      return { error: 'SLO not found' }
    }

    await requirePermission(user.id, slo.monitor.project.teamId, 'slo:update')

    const isEnabled = formData.get('isEnabled') === 'true'
    const target = formData.get('target')
      ? parseFloat(formData.get('target') as string)
      : undefined

    const updated = await prisma.sloDefinition.update({
      where: { id: sloId },
      data: {
        isEnabled,
        ...(target && { target }),
      },
    })

    revalidatePath(`/monitors/${slo.monitorId}/slos`)
    return { success: true, slo: updated }
  } catch (error) {
    console.error('Update SLO error:', error)
    return { error: 'Failed to update SLO definition' }
  }
}

export async function deleteSloDefinition(sloId: string) {
  try {
    const user = await requireAuth()

    const slo = await prisma.sloDefinition.findUnique({
      where: { id: sloId },
      include: {
        monitor: {
          include: {
            project: { include: { team: true } },
          },
        },
      },
    })

    if (!slo) {
      return { error: 'SLO not found' }
    }

    await requirePermission(user.id, slo.monitor.project.teamId, 'slo:delete')

    await prisma.sloDefinition.delete({
      where: { id: sloId },
    })

    revalidatePath(`/monitors/${slo.monitorId}/slos`)
    return { success: true }
  } catch (error) {
    console.error('Delete SLO error:', error)
    return { error: 'Failed to delete SLO definition' }
  }
}

export async function calculateSloWindow(sloId: string) {
  try {
    const slo = await prisma.sloDefinition.findUnique({
      where: { id: sloId },
      include: { monitor: true },
    })

    if (!slo || !slo.isEnabled) return null

    const windowEnd = new Date()
    const windowStart = subDays(windowEnd, slo.windowDays)

    let achieved: number

    if (slo.metricType === 'UPTIME') {
      // Calculate uptime percentage
      const checks = await prisma.monitorCheck.findMany({
        where: {
          monitorId: slo.monitorId,
          timestamp: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
      })

      const upCount = checks.filter(c => c.status === 'UP').length
      const totalCount = checks.length

      achieved = totalCount > 0 ? upCount / totalCount : 1
    } else {
      // Calculate latency percentile
      const checks = await prisma.monitorCheck.findMany({
        where: {
          monitorId: slo.monitorId,
          timestamp: {
            gte: windowStart,
            lte: windowEnd,
          },
          status: 'UP',
        },
        select: { responseTime: true },
        orderBy: { responseTime: 'asc' },
      })

      if (checks.length === 0) {
        achieved = 1 // No data means compliant
      } else {
        const percentile = slo.metricType === 'LATENCY_P95' ? 0.95 : 0.99
        const index = Math.floor(checks.length * percentile)
        const pValue = checks[index]?.responseTime || 0

        // Achieved is the ratio of threshold to actual (capped at 1)
        achieved = pValue <= slo.threshold ? 1 : slo.threshold / pValue
      }
    }

    // Calculate error budget
    const errorBudget = Math.max(0, slo.target - (1 - achieved))

    // Calculate burn rate (compare to previous window)
    const previousWindow = await prisma.sloWindow.findFirst({
      where: { sloId },
      orderBy: { windowEnd: 'desc' },
    })

    let burnRate = 1
    if (previousWindow) {
      const previousErrorBudget = previousWindow.errorBudget
      burnRate = previousErrorBudget > 0 ? errorBudget / previousErrorBudget : burnRate
    }

    // Check if breached
    const isBreached = achieved < slo.target

    // Create or update window
    const window = await prisma.sloWindow.create({
      data: {
        sloId,
        windowStart,
        windowEnd,
        achieved,
        target: slo.target,
        errorBudget,
        burnRate,
        isBreached,
      },
    })

    // Check for SLO breach alert
    if (isBreached && (!previousWindow || !previousWindow.isBreached)) {
      // Create incident for SLO breach
      await createSloBreachIncident(slo, achieved)
    }

    return window
  } catch (error) {
    console.error('Calculate SLO window error:', error)
    return null
  }
}

async function createSloBreachIncident(slo: any, achieved: number) {
  try {
    const monitor = await prisma.monitor.findUnique({
      where: { id: slo.monitorId },
    })

    if (!monitor) return

    const metricName = slo.metricType === 'UPTIME' 
      ? 'Uptime' 
      : slo.metricType === 'LATENCY_P95' 
        ? 'P95 Latency' 
        : 'P99 Latency'

    const achievedFormatted = slo.metricType === 'UPTIME'
      ? `${(achieved * 100).toFixed(2)}%`
      : `${achieved}ms`

    const targetFormatted = slo.metricType === 'UPTIME'
      ? `${(slo.target * 100).toFixed(2)}%`
      : `${slo.threshold}ms`

    await prisma.incident.create({
      data: {
        monitorId: slo.monitorId,
        severity: 'WARNING',
        category: 'DEGRADATION',
        title: `SLO Breach: ${slo.name}`,
        description: `${metricName} SLO breached. Achieved: ${achievedFormatted}, Target: ${targetFormatted}. Window: ${slo.windowDays} days.`,
      },
    })
  } catch (error) {
    console.error('Create SLO breach incident error:', error)
  }
}

export async function getSloSummary(projectId: string) {
  const user = await requireAuth()

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      team: { include: { members: true } },
      monitors: {
        include: {
          sloDefinitions: {
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

  if (!project) return null

  const isMember = project.team.members.some(m => m.userId === user.id)
  if (!isMember) return null

  const allSlos = project.monitors.flatMap(m => m.sloDefinitions)
  const enabledSlos = allSlos.filter(s => s.isEnabled)

  const total = enabledSlos.length
  const breached = enabledSlos.filter(s => 
    s.windows[0]?.isBreached
  ).length
  const atRisk = enabledSlos.filter(s => {
    const window = s.windows[0]
    if (!window) return false
    return !window.isBreached && window.burnRate > 1.5
  }).length

  const complianceRate = total > 0 
    ? ((total - breached) / total) * 100 
    : 100

  return {
    total,
    breached,
    atRisk,
    compliant: total - breached - atRisk,
    complianceRate: Math.round(complianceRate * 100) / 100,
  }
}

export async function calculateAllSlos() {
  // This is called by cron job
  const slos = await prisma.sloDefinition.findMany({
    where: { isEnabled: true },
  })

  const results = []
  for (const slo of slos) {
    const window = await calculateSloWindow(slo.id)
    results.push({
      sloId: slo.id,
      success: !!window,
    })
  }

  return { success: true, calculated: results.length }
}
