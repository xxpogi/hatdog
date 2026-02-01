import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { IncidentCategory } from '@prisma/client'

export const runtime = 'edge'
export const preferredRegion = ['iad1']

interface RcaContext {
  incident: {
    startedAt: Date
    resolvedAt?: Date | null
    duration?: number | null
    category?: IncidentCategory | null
    title: string
    description?: string | null
    affectedRegions: string[]
  }
  checks: Array<{
    timestamp: Date
    status: string
    statusCode?: number | null
    responseTime: number
    errorMessage?: string | null
    region: { region: string }
  }>
  networkEvents: Array<{
    timestamp: Date
    eventType: string
    confidence: number
    description: string
    signals: any
  }>
  historicalBaseline: {
    avgResponseTime: number
    p95ResponseTime: number
    uptimePercentage: number
    errorRate: number
  }
}

interface RcaResult {
  confidence: number
  summary: string
  rootCause: string
  category: IncidentCategory
  evidence: {
    keyMetrics: string[]
    timeline: string[]
    affectedRegions: string[]
  }
  recommendations: string[]
}

async function gatherIncidentContext(incidentId: string): Promise<RcaContext | null> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      monitor: true,
      checks: {
        include: { region: true },
        orderBy: { timestamp: 'asc' },
      },
      networkEvents: {
        orderBy: { timestamp: 'asc' },
      },
    },
  })

  if (!incident) return null

  // Get historical baseline (7 days before incident)
  const baselineStart = new Date(incident.startedAt.getTime() - 7 * 24 * 60 * 60 * 1000)
  const baselineEnd = incident.startedAt

  const baselineChecks = await prisma.monitorCheck.findMany({
    where: {
      monitorId: incident.monitorId,
      timestamp: {
        gte: baselineStart,
        lte: baselineEnd,
      },
    },
  })

  const upChecks = baselineChecks.filter(c => c.status === 'UP')
  const avgResponseTime = upChecks.length > 0
    ? upChecks.reduce((sum, c) => sum + c.responseTime, 0) / upChecks.length
    : 0

  const sortedTimes = upChecks.map(c => c.responseTime).sort((a, b) => a - b)
  const p95Index = Math.floor(sortedTimes.length * 0.95)
  const p95ResponseTime = sortedTimes[p95Index] || 0

  const uptimePercentage = baselineChecks.length > 0
    ? (upChecks.length / baselineChecks.length) * 100
    : 100

  const errorChecks = baselineChecks.filter(c => c.status !== 'UP')
  const errorRate = baselineChecks.length > 0
    ? (errorChecks.length / baselineChecks.length) * 100
    : 0

  return {
    incident: {
      startedAt: incident.startedAt,
      resolvedAt: incident.resolvedAt,
      duration: incident.duration,
      category: incident.category,
      title: incident.title,
      description: incident.description,
      affectedRegions: incident.affectedRegions,
    },
    checks: incident.checks,
    networkEvents: incident.networkEvents,
    historicalBaseline: {
      avgResponseTime,
      p95ResponseTime,
      uptimePercentage,
      errorRate,
    },
  }
}

function generateRuleBasedRca(context: RcaContext): RcaResult {
  const { incident, checks, networkEvents, historicalBaseline } = context

  // Analyze patterns
  const failedChecks = checks.filter(c => c.status !== 'UP')
  const timeoutChecks = checks.filter(c => c.status === 'TIMEOUT')
  const errorChecks = checks.filter(c => c.status === 'ERROR')
  const degradedChecks = checks.filter(c => c.status === 'DEGRADED')

  // Status code analysis
  const statusCodes = new Map<number, number>()
  checks.forEach(c => {
    if (c.statusCode) {
      statusCodes.set(c.statusCode, (statusCodes.get(c.statusCode) || 0) + 1)
    }
  })

  // Region analysis
  const regionStats = new Map<string, { total: number; failed: number }>()
  checks.forEach(c => {
    const region = c.region.region
    const stats = regionStats.get(region) || { total: 0, failed: 0 }
    stats.total++
    if (c.status !== 'UP') stats.failed++
    regionStats.set(region, stats)
  })

  // Determine root cause category
  let category = incident.category || IncidentCategory.UNKNOWN
  let rootCause = 'Unknown'
  let confidence = 0.5
  const evidence: string[] = []
  const recommendations: string[] = []

  // Check for DDoS indicators
  const has429s = statusCodes.get(429) || 0 > 0
  const has503s = statusCodes.get(503) || 0 > 0
  const hasMany5xxs = Array.from(statusCodes.entries())
    .filter(([code]) => code >= 500)
    .reduce((sum, [, count]) => sum + count, 0) > failedChecks.length * 0.3

  if (has429s || (has503s && networkEvents.some(e => e.eventType === 'DDOS_HEURISTIC'))) {
    category = IncidentCategory.DDOS_SUSPICION
    rootCause = 'Possible DDoS attack or traffic overload'
    confidence = 0.75
    evidence.push('Rate limiting (429) or service unavailable (503) responses detected')
    evidence.push('Abnormal traffic patterns observed')
    recommendations.push('Enable DDoS protection (Cloudflare, AWS Shield)')
    recommendations.push('Implement rate limiting at edge')
    recommendations.push('Consider scaling infrastructure')
  }
  // Check for network issues
  else if (timeoutChecks.length > failedChecks.length * 0.5) {
    category = IncidentCategory.NETWORK_ISSUE
    rootCause = 'Network connectivity or routing issue'
    confidence = 0.7
    evidence.push(`High timeout rate: ${timeoutChecks.length}/${checks.length} checks timed out`)
    
    const affectedRegions = Array.from(regionStats.entries())
      .filter(([, stats]) => stats.failed / stats.total > 0.5)
      .map(([region]) => region)
    
    if (affectedRegions.length > 0) {
      evidence.push(`Affected regions: ${affectedRegions.join(', ')}`)
    }
    
    recommendations.push('Check network connectivity from affected regions')
    recommendations.push('Verify DNS resolution is working correctly')
    recommendations.push('Contact hosting provider if issue persists')
  }
  // Check for configuration issues
  else if (statusCodes.get(403) || statusCodes.get(401)) {
    category = IncidentCategory.CONFIGURATION
    rootCause = 'Authentication or authorization issue'
    confidence = 0.8
    evidence.push('Access denied responses (401/403) detected')
    recommendations.push('Check SSL certificate validity')
    recommendations.push('Verify firewall and security group rules')
    recommendations.push('Review authentication configuration')
  }
  // Check for server errors
  else if (hasMany5xxs) {
    category = IncidentCategory.OUTAGE
    rootCause = 'Server-side error or application crash'
    confidence = 0.75
    evidence.push('Multiple 5xx error responses detected')
    
    const mainStatusCode = Array.from(statusCodes.entries())
      .filter(([code]) => code >= 500)
      .sort((a, b) => b[1] - a[1])[0]
    
    if (mainStatusCode) {
      evidence.push(`Primary error code: ${mainStatusCode[0]} (${mainStatusCode[1]} occurrences)`)
    }
    
    recommendations.push('Check application logs for errors')
    recommendations.push('Verify database connectivity')
    recommendations.push('Review recent deployments for regressions')
  }
  // Check for degradation
  else if (degradedChecks.length > 0) {
    const avgResponseTime = checks
      .filter(c => c.status === 'UP')
      .reduce((sum, c) => sum + c.responseTime, 0) / checks.filter(c => c.status === 'UP').length

    if (avgResponseTime > historicalBaseline.avgResponseTime * 2) {
      category = IncidentCategory.DEGRADATION
      rootCause = 'Performance degradation - slow response times'
      confidence = 0.7
      evidence.push(`Average response time: ${Math.round(avgResponseTime)}ms`)
      evidence.push(`Baseline average: ${Math.round(historicalBaseline.avgResponseTime)}ms`)
      evidence.push(`Degradation factor: ${(avgResponseTime / historicalBaseline.avgResponseTime).toFixed(2)}x`)
      recommendations.push('Check server resource utilization (CPU, memory)')
      recommendations.push('Review database query performance')
      recommendations.push('Consider scaling or optimization')
    }
  }
  // Check for packet loss pattern
  else if (networkEvents.some(e => e.eventType === 'PACKET_LOSS')) {
    category = IncidentCategory.PACKET_LOSS
    rootCause = 'Network packet loss causing intermittent failures'
    confidence = 0.65
    evidence.push('Intermittent connection failures detected')
    evidence.push('Partial availability pattern observed')
    recommendations.push('Check network infrastructure health')
    recommendations.push('Verify ISP connectivity')
    recommendations.push('Consider multi-region deployment')
  }
  // Third party issues
  else if (failedChecks.length > 0 && failedChecks.every(c => !c.statusCode)) {
    category = IncidentCategory.THIRD_PARTY
    rootCause = 'Possible third-party service or DNS issue'
    confidence = 0.6
    evidence.push('Connection failures without HTTP response')
    recommendations.push('Check DNS resolution')
    recommendations.push('Verify CDN status')
    recommendations.push('Check upstream service health')
  }

  // Build timeline
  const timeline: string[] = []
  const significantChecks = checks.filter((c, i) => {
    if (i === 0) return true
    if (i === checks.length - 1) return true
    if (c.status !== 'UP') return true
    return false
  })

  significantChecks.slice(0, 10).forEach(c => {
    const time = c.timestamp.toISOString()
    if (c.status === 'UP') {
      timeline.push(`${time}: OK (${c.responseTime}ms)`)
    } else {
      timeline.push(`${time}: ${c.status}${c.statusCode ? ` (${c.statusCode})` : ''} - ${c.errorMessage || 'No details'}`)
    }
  })

  // Generate summary
  const duration = incident.duration 
    ? `${Math.floor(incident.duration / 60)}m ${incident.duration % 60}s`
    : 'ongoing'

  const summary = `Incident started at ${incident.startedAt.toISOString()} and lasted ${duration}. ` +
    `${failedChecks.length} out of ${checks.length} checks failed. ` +
    `Root cause: ${rootCause}. ` +
    `Confidence: ${Math.round(confidence * 100)}%`

  return {
    confidence,
    summary,
    rootCause,
    category,
    evidence: {
      keyMetrics: evidence,
      timeline,
      affectedRegions: Array.from(regionStats.entries())
        .filter(([, stats]) => stats.failed > 0)
        .map(([region]) => region),
    },
    recommendations,
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { incidentId } = body

    if (!incidentId) {
      return NextResponse.json(
        { error: 'Missing incidentId' },
        { status: 400 }
      )
    }

    const context = await gatherIncidentContext(incidentId)

    if (!context) {
      return NextResponse.json(
        { error: 'Incident not found' },
        { status: 404 }
      )
    }

    // Generate RCA using rule-based analysis
    const rca = generateRuleBasedRca(context)

    // Store RCA report
    const existingReport = await prisma.rcaReport.findUnique({
      where: { incidentId },
    })

    if (existingReport) {
      await prisma.rcaReport.update({
        where: { incidentId },
        data: {
          confidence: rca.confidence,
          summary: rca.summary,
          rootCause: rca.rootCause,
          evidence: rca.evidence as any,
          recommendations: rca.recommendations,
        },
      })
    } else {
      await prisma.rcaReport.create({
        data: {
          incidentId,
          confidence: rca.confidence,
          summary: rca.summary,
          rootCause: rca.rootCause,
          evidence: rca.evidence as any,
          recommendations: rca.recommendations,
        },
      })
    }

    // Update incident category if different
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
    })

    if (incident && incident.category !== rca.category) {
      await prisma.incident.update({
        where: { id: incidentId },
        data: { category: rca.category },
      })
    }

    return NextResponse.json({
      success: true,
      rca: {
        confidence: rca.confidence,
        summary: rca.summary,
        rootCause: rca.rootCause,
        category: rca.category,
        evidence: rca.evidence,
        recommendations: rca.recommendations,
      },
    })
  } catch (error) {
    console.error('RCA generation error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const incidentId = searchParams.get('incidentId')

    if (!incidentId) {
      return NextResponse.json(
        { error: 'Missing incidentId' },
        { status: 400 }
      )
    }

    const rcaReport = await prisma.rcaReport.findUnique({
      where: { incidentId },
    })

    if (!rcaReport) {
      return NextResponse.json(
        { error: 'RCA report not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      rca: {
        confidence: rcaReport.confidence,
        summary: rcaReport.summary,
        rootCause: rcaReport.rootCause,
        evidence: rcaReport.evidence,
        recommendations: rcaReport.recommendations,
        generatedAt: rcaReport.generatedAt,
      },
    })
  } catch (error) {
    console.error('Get RCA error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
