import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { CheckStatus, Region } from '@prisma/client'

export const runtime = 'edge'
export const preferredRegion = ['iad1', 'fra1', 'sin1']

interface CheckResult {
  status: CheckStatus
  statusCode?: number
  responseTime: number
  dnsTime?: number
  connectTime?: number
  tlsTime?: number
  ttfb?: number
  errorMessage?: string
  headers?: Record<string, string>
  responseBody?: string
}

async function performHealthCheck(
  url: string,
  method: string,
  timeout: number,
  expectedStatus?: number,
  followRedirects: boolean = true,
  verifySsl: boolean = true
): Promise<CheckResult> {
  const startTime = Date.now()
  const timings = {
    dnsStart: 0,
    dnsEnd: 0,
    connectStart: 0,
    connectEnd: 0,
    tlsStart: 0,
    tlsEnd: 0,
    ttfb: 0,
  }

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout * 1000)

    const fetchOptions: RequestInit = {
      method,
      signal: controller.signal,
      redirect: followRedirects ? 'follow' : 'manual',
    }

    // Note: In edge environment, we can't easily get detailed timing breakdowns
    // In production, you'd use a more sophisticated approach

    const response = await fetch(url, fetchOptions)
    clearTimeout(timeoutId)

    const responseTime = Date.now() - startTime
    const statusCode = response.status

    // Determine status based on expected status code
    let status: CheckStatus = CheckStatus.UP
    if (expectedStatus && statusCode !== expectedStatus) {
      status = CheckStatus.DOWN
    } else if (statusCode >= 500) {
      status = CheckStatus.DOWN
    } else if (statusCode >= 400) {
      status = CheckStatus.DEGRADED
    }

    // Check for degraded performance
    if (responseTime > 5000) {
      status = CheckStatus.DEGRADED
    }

    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })

    // Read response body (limited)
    let responseBody = ''
    try {
      const clonedResponse = response.clone()
      responseBody = await clonedResponse.text()
      responseBody = responseBody.slice(0, 10000) // Limit to 10KB
    } catch {
      // Ignore body read errors
    }

    return {
      status,
      statusCode,
      responseTime,
      headers,
      responseBody,
    }
  } catch (error) {
    const responseTime = Date.now() - startTime
    
    let status: CheckStatus = CheckStatus.ERROR
    let errorMessage = 'Unknown error'

    if (error instanceof Error) {
      errorMessage = error.message
      
      if (error.name === 'AbortError') {
        status = CheckStatus.TIMEOUT
        errorMessage = `Request timed out after ${timeout}s`
      } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
        status = CheckStatus.DOWN
        errorMessage = 'DNS resolution failed'
      } else if (errorMessage.includes('ECONNREFUSED')) {
        status = CheckStatus.DOWN
        errorMessage = 'Connection refused'
      } else if (errorMessage.includes('SSL') || errorMessage.includes('TLS') || errorMessage.includes('certificate')) {
        status = CheckStatus.DOWN
        errorMessage = 'SSL/TLS error'
      }
    }

    return {
      status,
      responseTime,
      errorMessage,
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { monitorId, regionId } = body

    if (!monitorId || !regionId) {
      return NextResponse.json(
        { error: 'Missing monitorId or regionId' },
        { status: 400 }
      )
    }

    // Get monitor configuration
    const monitor = await prisma.monitor.findUnique({
      where: { id: monitorId },
      include: { regions: true },
    })

    if (!monitor || !monitor.isEnabled) {
      return NextResponse.json(
        { error: 'Monitor not found or disabled' },
        { status: 404 }
      )
    }

    // Verify region is enabled for this monitor
    const region = monitor.regions.find(r => r.id === regionId && r.isEnabled)
    if (!region) {
      return NextResponse.json(
        { error: 'Region not enabled for this monitor' },
        { status: 400 }
      )
    }

    // Perform the health check
    const result = await performHealthCheck(
      monitor.url,
      monitor.method,
      monitor.timeout,
      monitor.expectedStatus || undefined,
      monitor.followRedirects,
      monitor.verifySsl
    )

    // Store the check result
    const check = await prisma.monitorCheck.create({
      data: {
        monitorId,
        regionId,
        status: result.status,
        statusCode: result.statusCode,
        responseTime: result.responseTime,
        responseBody: result.responseBody,
        headers: result.headers,
        errorMessage: result.errorMessage,
        dnsTime: result.dnsTime,
        connectTime: result.connectTime,
        tlsTime: result.tlsTime,
        ttfb: result.ttfb,
      },
    })

    // Check for incident creation/recovery
    await handleIncidentLogic(monitorId, result)

    return NextResponse.json({
      success: true,
      check: {
        id: check.id,
        status: result.status,
        responseTime: result.responseTime,
        statusCode: result.statusCode,
      },
    })
  } catch (error) {
    console.error('Monitor check error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

async function handleIncidentLogic(monitorId: string, result: CheckResult) {
  try {
    // Find any open incident for this monitor
    const openIncident = await prisma.incident.findFirst({
      where: {
        monitorId,
        resolvedAt: null,
      },
    })

    if (result.status === CheckStatus.UP) {
      // If we have an open incident and check is UP, potentially resolve it
      if (openIncident) {
        // Get recent checks to confirm recovery
        const recentChecks = await prisma.monitorCheck.findMany({
          where: {
            monitorId,
            timestamp: {
              gte: new Date(Date.now() - 5 * 60 * 1000), // Last 5 minutes
            },
          },
          orderBy: { timestamp: 'desc' },
          take: 3,
        })

        // If all recent checks are UP, resolve the incident
        if (recentChecks.every(c => c.status === CheckStatus.UP)) {
          const resolvedAt = new Date()
          const duration = Math.round(
            (resolvedAt.getTime() - openIncident.startedAt.getTime()) / 1000
          )

          await prisma.incident.update({
            where: { id: openIncident.id },
            data: {
              resolvedAt,
              duration,
            },
          })

          // Trigger recovery alerts
          await triggerRecoveryAlerts(openIncident.id)
        }
      }
    } else if (result.status === CheckStatus.DOWN || result.status === CheckStatus.TIMEOUT) {
      // If no open incident, create one
      if (!openIncident) {
        // Wait for consecutive failures before creating incident
        const recentChecks = await prisma.monitorCheck.findMany({
          where: {
            monitorId,
            timestamp: {
              gte: new Date(Date.now() - 5 * 60 * 1000),
            },
          },
          orderBy: { timestamp: 'desc' },
          take: 3,
        })

        if (recentChecks.filter(c => c.status !== CheckStatus.UP).length >= 2) {
          const incident = await prisma.incident.create({
            data: {
              monitorId,
              severity: result.status === CheckStatus.TIMEOUT ? 'WARNING' : 'CRITICAL',
              category: 'OUTAGE',
              title: `Monitor down: ${result.errorMessage || 'Connection failed'}`,
              description: `Status: ${result.status}, Response time: ${result.responseTime}ms`,
            },
          })

          // Trigger downtime alerts
          await triggerDowntimeAlerts(incident.id)
        }
      }
    }
  } catch (error) {
    console.error('Incident logic error:', error)
  }
}

async function triggerDowntimeAlerts(incidentId: string) {
  // Implementation for triggering alerts
  // This would queue alerts for delivery
}

async function triggerRecoveryAlerts(incidentId: string) {
  // Implementation for triggering recovery alerts
}
