'use server'

import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { requirePermission } from '@/lib/rbac'
import { createDashboardSchema, dashboardPanelSchema } from '@/lib/validators'
import { revalidatePath } from 'next/cache'

export async function getDashboards(projectId: string) {
  const user = await requireAuth()

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      team: { include: { members: true } },
    },
  })

  if (!project) return []

  const isMember = project.team.members.some(m => m.userId === user.id)
  if (!isMember) return []

  return prisma.dashboard.findMany({
    where: { projectId },
    include: {
      _count: { select: { panels: true } },
    },
    orderBy: [
      { isDefault: 'desc' },
      { updatedAt: 'desc' },
    ],
  })
}

export async function getDashboardById(dashboardId: string) {
  const user = await requireAuth()

  const dashboard = await prisma.dashboard.findUnique({
    where: { id: dashboardId },
    include: {
      project: {
        include: {
          team: { include: { members: true } },
          monitors: {
            where: { deletedAt: null, isEnabled: true },
            select: { id: true, name: true, url: true },
          },
        },
      },
      panels: {
        orderBy: { id: 'asc' },
      },
    },
  })

  if (!dashboard) return null

  const isMember = dashboard.project.team.members.some(m => m.userId === user.id)
  if (!isMember) return null

  return dashboard
}

export async function createDashboard(projectId: string, formData: FormData) {
  try {
    const user = await requireAuth()

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { team: true },
    })

    if (!project) {
      return { error: 'Project not found' }
    }

    await requirePermission(user.id, project.teamId, 'dashboard:create')

    const name = formData.get('name') as string
    const description = formData.get('description') as string | undefined
    const layoutJson = formData.get('layout') as string
    const layout = layoutJson ? JSON.parse(layoutJson) : undefined

    const validated = createDashboardSchema.parse({
      name,
      description,
      layout,
    })

    const dashboard = await prisma.dashboard.create({
      data: {
        name: validated.name,
        description: validated.description,
        layout: validated.layout as any,
        projectId,
      },
    })

    revalidatePath(`/projects/${projectId}/dashboards`)
    return { success: true, dashboard }
  } catch (error) {
    console.error('Create dashboard error:', error)
    return { error: 'Failed to create dashboard' }
  }
}

export async function updateDashboard(dashboardId: string, formData: FormData) {
  try {
    const user = await requireAuth()

    const dashboard = await prisma.dashboard.findUnique({
      where: { id: dashboardId },
      include: {
        project: { include: { team: true } },
      },
    })

    if (!dashboard) {
      return { error: 'Dashboard not found' }
    }

    await requirePermission(user.id, dashboard.project.teamId, 'dashboard:update')

    const name = formData.get('name') as string | undefined
    const description = formData.get('description') as string | undefined
    const layoutJson = formData.get('layout') as string | undefined
    const isShared = formData.get('isShared') === 'true'

    const updateData: any = {}
    if (name) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (layoutJson) updateData.layout = JSON.parse(layoutJson)
    if (formData.has('isShared')) updateData.isShared = isShared

    const updated = await prisma.dashboard.update({
      where: { id: dashboardId },
      data: updateData,
    })

    revalidatePath(`/dashboards/${dashboardId}`)
    return { success: true, dashboard: updated }
  } catch (error) {
    console.error('Update dashboard error:', error)
    return { error: 'Failed to update dashboard' }
  }
}

export async function deleteDashboard(dashboardId: string) {
  try {
    const user = await requireAuth()

    const dashboard = await prisma.dashboard.findUnique({
      where: { id: dashboardId },
      include: {
        project: { include: { team: true } },
      },
    })

    if (!dashboard) {
      return { error: 'Dashboard not found' }
    }

    await requirePermission(user.id, dashboard.project.teamId, 'dashboard:delete')

    await prisma.dashboard.delete({
      where: { id: dashboardId },
    })

    revalidatePath(`/projects/${dashboard.projectId}/dashboards`)
    return { success: true }
  } catch (error) {
    console.error('Delete dashboard error:', error)
    return { error: 'Failed to delete dashboard' }
  }
}

export async function addDashboardPanel(dashboardId: string, formData: FormData) {
  try {
    const user = await requireAuth()

    const dashboard = await prisma.dashboard.findUnique({
      where: { id: dashboardId },
      include: {
        project: { include: { team: true } },
      },
    })

    if (!dashboard) {
      return { error: 'Dashboard not found' }
    }

    await requirePermission(user.id, dashboard.project.teamId, 'dashboard:update')

    const title = formData.get('title') as string
    const type = formData.get('type') as any
    const configJson = formData.get('config') as string
    const positionJson = formData.get('position') as string
    const queryJson = formData.get('query') as string
    const refreshRate = formData.get('refreshRate')
      ? parseInt(formData.get('refreshRate') as string)
      : undefined

    const validated = dashboardPanelSchema.parse({
      title,
      type,
      config: JSON.parse(configJson),
      position: JSON.parse(positionJson),
      query: JSON.parse(queryJson),
      refreshRate,
    })

    const panel = await prisma.dashboardPanel.create({
      data: {
        title: validated.title,
        type: validated.type,
        config: validated.config as any,
        position: validated.position as any,
        query: validated.query as any,
        refreshRate: validated.refreshRate,
        dashboardId,
      },
    })

    revalidatePath(`/dashboards/${dashboardId}`)
    return { success: true, panel }
  } catch (error) {
    console.error('Add panel error:', error)
    return { error: 'Failed to add panel' }
  }
}

export async function updateDashboardPanel(panelId: string, formData: FormData) {
  try {
    const user = await requireAuth()

    const panel = await prisma.dashboardPanel.findUnique({
      where: { id: panelId },
      include: {
        dashboard: {
          include: {
            project: { include: { team: true } },
          },
        },
      },
    })

    if (!panel) {
      return { error: 'Panel not found' }
    }

    await requirePermission(user.id, panel.dashboard.project.teamId, 'dashboard:update')

    const positionJson = formData.get('position') as string | undefined
    const configJson = formData.get('config') as string | undefined

    const updateData: any = {}
    if (positionJson) updateData.position = JSON.parse(positionJson)
    if (configJson) updateData.config = JSON.parse(configJson)

    const updated = await prisma.dashboardPanel.update({
      where: { id: panelId },
      data: updateData,
    })

    revalidatePath(`/dashboards/${panel.dashboardId}`)
    return { success: true, panel: updated }
  } catch (error) {
    console.error('Update panel error:', error)
    return { error: 'Failed to update panel' }
  }
}

export async function removeDashboardPanel(panelId: string) {
  try {
    const user = await requireAuth()

    const panel = await prisma.dashboardPanel.findUnique({
      where: { id: panelId },
      include: {
        dashboard: {
          include: {
            project: { include: { team: true } },
          },
        },
      },
    })

    if (!panel) {
      return { error: 'Panel not found' }
    }

    await requirePermission(user.id, panel.dashboard.project.teamId, 'dashboard:update')

    await prisma.dashboardPanel.delete({
      where: { id: panelId },
    })

    revalidatePath(`/dashboards/${panel.dashboardId}`)
    return { success: true }
  } catch (error) {
    console.error('Remove panel error:', error)
    return { error: 'Failed to remove panel' }
  }
}

export async function getPanelData(panelId: string, timeRange: number = 86400000) {
  try {
    const user = await requireAuth()

    const panel = await prisma.dashboardPanel.findUnique({
      where: { id: panelId },
      include: {
        dashboard: {
          include: {
            project: {
              include: {
                team: { include: { members: true } },
              },
            },
          },
        },
      },
    })

    if (!panel) return null

    const isMember = panel.dashboard.project.team.members.some(m => m.userId === user.id)
    if (!isMember) return null

    const query = panel.query as any
    if (!query.monitorId) return null

    const endTime = new Date()
    const startTime = new Date(endTime.getTime() - timeRange)

    // Fetch data based on panel type and query
    const checks = await prisma.monitorCheck.findMany({
      where: {
        monitorId: query.monitorId,
        timestamp: {
          gte: startTime,
          lte: endTime,
        },
        ...(query.regionId && { regionId: query.regionId }),
      },
      orderBy: { timestamp: 'asc' },
    })

    // Aggregate data based on metric type
    let data: any[] = []

    switch (query.metric) {
      case 'responseTime':
        data = checks.map(c => ({
          timestamp: c.timestamp,
          value: c.responseTime,
          status: c.status,
        }))
        break

      case 'status':
        // Group by time buckets for status
        const timeBuckets = new Map<string, { up: number; down: number; total: number }>()
        const bucketSize = Math.max(60000, Math.floor(timeRange / 100)) // At least 1 min buckets

        checks.forEach(check => {
          const bucketKey = Math.floor(check.timestamp.getTime() / bucketSize) * bucketSize
          const bucket = timeBuckets.get(String(bucketKey)) || { up: 0, down: 0, total: 0 }
          bucket.total++
          if (check.status === 'UP') bucket.up++
          else bucket.down++
          timeBuckets.set(String(bucketKey), bucket)
        })

        data = Array.from(timeBuckets.entries()).map(([timestamp, stats]) => ({
          timestamp: new Date(parseInt(timestamp)),
          value: stats.total > 0 ? (stats.up / stats.total) * 100 : 0,
          up: stats.up,
          down: stats.down,
        }))
        break

      case 'errorRate':
        const errorBuckets = new Map<string, { errors: number; total: number }>()
        const errorBucketSize = Math.max(60000, Math.floor(timeRange / 100))

        checks.forEach(check => {
          const bucketKey = Math.floor(check.timestamp.getTime() / errorBucketSize) * errorBucketSize
          const bucket = errorBuckets.get(String(bucketKey)) || { errors: 0, total: 0 }
          bucket.total++
          if (check.status !== 'UP') bucket.errors++
          errorBuckets.set(String(bucketKey), bucket)
        })

        data = Array.from(errorBuckets.entries()).map(([timestamp, stats]) => ({
          timestamp: new Date(parseInt(timestamp)),
          value: stats.total > 0 ? (stats.errors / stats.total) * 100 : 0,
        }))
        break

      default:
        data = checks.map(c => ({
          timestamp: c.timestamp,
          value: c.responseTime,
          status: c.status,
        }))
    }

    return {
      panel,
      data,
      meta: {
        count: checks.length,
        startTime,
        endTime,
      },
    }
  } catch (error) {
    console.error('Get panel data error:', error)
    return null
  }
}

export async function setDefaultDashboard(dashboardId: string) {
  try {
    const user = await requireAuth()

    const dashboard = await prisma.dashboard.findUnique({
      where: { id: dashboardId },
      include: {
        project: { include: { team: true } },
      },
    })

    if (!dashboard) {
      return { error: 'Dashboard not found' }
    }

    await requirePermission(user.id, dashboard.project.teamId, 'dashboard:update')

    // Unset current default
    await prisma.dashboard.updateMany({
      where: {
        projectId: dashboard.projectId,
        isDefault: true,
      },
      data: { isDefault: false },
    })

    // Set new default
    await prisma.dashboard.update({
      where: { id: dashboardId },
      data: { isDefault: true },
    })

    revalidatePath(`/projects/${dashboard.projectId}/dashboards`)
    return { success: true }
  } catch (error) {
    console.error('Set default dashboard error:', error)
    return { error: 'Failed to set default dashboard' }
  }
}
