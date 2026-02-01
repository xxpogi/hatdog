import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { subDays } from 'date-fns'

export const runtime = 'edge'

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const results: Record<string, number> = {}

    // Delete old monitor checks (keep 90 days)
    const checksCutoff = subDays(new Date(), 90)
    const deletedChecks = await prisma.monitorCheck.deleteMany({
      where: {
        timestamp: { lt: checksCutoff },
      },
    })
    results.checksDeleted = deletedChecks.count

    // Delete old resolved incidents (keep 1 year)
    const incidentsCutoff = subDays(new Date(), 365)
    const deletedIncidents = await prisma.incident.deleteMany({
      where: {
        resolvedAt: { lt: incidentsCutoff },
      },
    })
    results.incidentsDeleted = deletedIncidents.count

    // Delete old network events (keep 30 days)
    const eventsCutoff = subDays(new Date(), 30)
    const deletedEvents = await prisma.networkEvent.deleteMany({
      where: {
        timestamp: { lt: eventsCutoff },
      },
    })
    results.networkEventsDeleted = deletedEvents.count

    // Delete old alerts (keep 90 days)
    const alertsCutoff = subDays(new Date(), 90)
    const deletedAlerts = await prisma.alert.deleteMany({
      where: {
        sentAt: { lt: alertsCutoff },
      },
    })
    results.alertsDeleted = deletedAlerts.count

    // Delete expired sessions
    const deletedSessions = await prisma.session.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    })
    results.sessionsDeleted = deletedSessions.count

    return NextResponse.json({
      success: true,
      cleanup: results,
    })
  } catch (error) {
    console.error('Cleanup cron error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
