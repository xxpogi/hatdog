'use server'

import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { subDays } from 'date-fns'

export async function getIncidents(projectId: string, options?: { status?: string; limit?: number }) {
  const user = await requireAuth()

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { team: { include: { members: true } } },
  })

  if (!project) return []

  const isMember = project.team.members.some(m => m.userId === user.id)
  if (!isMember) return []

  const where: any = {
    monitor: { projectId },
  }

  if (options?.status === 'open') {
    where.resolvedAt = null
  } else if (options?.status === 'resolved') {
    where.resolvedAt = { not: null }
  }

  const incidents = await prisma.incident.findMany({
    where,
    include: {
      monitor: {
        select: { id: true, name: true, url: true },
      },
      rcaReport: true,
      _count: {
        select: { checks: true },
      },
    },
    orderBy: { startedAt: 'desc' },
    take: options?.limit || 50,
  })

  return incidents
}

export async function getIncidentById(incidentId: string) {
  const user = await requireAuth()

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
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
      checks: {
        orderBy: { timestamp: 'desc' },
        take: 100,
        include: {
          region: true,
        },
      },
      rcaReport: true,
      networkEvents: {
        orderBy: { timestamp: 'desc' },
      },
      alerts: {
        include: {
          config: true,
        },
      },
    },
  })

  if (!incident) return null

  const isMember = incident.monitor.project.team.members.some(m => m.userId === user.id)
  if (!isMember) return null

  return incident
}

export async function getIncidentTimeline(incidentId: string) {
  const user = await requireAuth()

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
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
    },
  })

  if (!incident) return null

  const isMember = incident.monitor.project.team.members.some(m => m.userId === user.id)
  if (!isMember) return null

  // Get checks 1 hour before and after the incident
  const startTime = new Date(incident.startedAt.getTime() - 60 * 60 * 1000)
  const endTime = incident.resolvedAt
    ? new Date(incident.resolvedAt.getTime() + 60 * 60 * 1000)
    : new Date()

  const checks = await prisma.monitorCheck.findMany({
    where: {
      monitorId: incident.monitorId,
      timestamp: {
        gte: startTime,
        lte: endTime,
      },
    },
    orderBy: { timestamp: 'asc' },
    include: {
      region: true,
    },
  })

  const networkEvents = await prisma.networkEvent.findMany({
    where: {
      incidentId,
    },
    orderBy: { timestamp: 'asc' },
  })

  return {
    incident,
    checks,
    networkEvents,
  }
}

export async function resolveIncident(incidentId: string) {
  try {
    const user = await requireAuth()

    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        monitor: {
          include: {
            project: { include: { team: true } },
          },
        },
      },
    })

    if (!incident) {
      return { error: 'Incident not found' }
    }

    if (incident.resolvedAt) {
      return { error: 'Incident already resolved' }
    }

    const resolvedAt = new Date()
    const duration = Math.round((resolvedAt.getTime() - incident.startedAt.getTime()) / 1000)

    const updated = await prisma.incident.update({
      where: { id: incidentId },
      data: {
        resolvedAt,
        duration,
      },
    })

    revalidatePath(`/incidents/${incidentId}`)
    return { success: true, incident: updated }
  } catch (error) {
    console.error('Resolve incident error:', error)
    return { error: 'Failed to resolve incident' }
  }
}

export async function addIncidentNote(incidentId: string, note: string) {
  try {
    const user = await requireAuth()

    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        monitor: {
          include: {
            project: { include: { team: true } },
          },
        },
      },
    })

    if (!incident) {
      return { error: 'Incident not found' }
    }

    // For now, we'll store notes in the incident description
    // In a real app, you'd have a separate notes table
    const updatedDescription = incident.description
      ? `${incident.description}\n\n[${new Date().toISOString()}] ${user.name || user.email}: ${note}`
      : `[${new Date().toISOString()}] ${user.name || user.email}: ${note}`

    const updated = await prisma.incident.update({
      where: { id: incidentId },
      data: { description: updatedDescription },
    })

    revalidatePath(`/incidents/${incidentId}`)
    return { success: true, incident: updated }
  } catch (error) {
    console.error('Add note error:', error)
    return { error: 'Failed to add note' }
  }
}

export async function getIncidentStats(projectId: string, days: number = 30) {
  const user = await requireAuth()

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { team: { include: { members: true } } },
  })

  if (!project) return null

  const isMember = project.team.members.some(m => m.userId === user.id)
  if (!isMember) return null

  const startDate = subDays(new Date(), days)

  const incidents = await prisma.incident.findMany({
    where: {
      monitor: { projectId },
      startedAt: { gte: startDate },
    },
  })

  const total = incidents.length
  const resolved = incidents.filter(i => i.resolvedAt).length
  const open = total - resolved

  const avgDuration = incidents
    .filter(i => i.duration)
    .reduce((sum, i) => sum + (i.duration || 0), 0) / (resolved || 1)

  const byCategory = incidents.reduce((acc, i) => {
    const cat = i.category || 'UNKNOWN'
    acc[cat] = (acc[cat] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const bySeverity = incidents.reduce((acc, i) => {
    acc[i.severity] = (acc[i.severity] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return {
    total,
    resolved,
    open,
    avgDuration: Math.round(avgDuration),
    byCategory,
    bySeverity,
    mttr: Math.round(avgDuration / 60), // Mean time to resolution in minutes
  }
}
