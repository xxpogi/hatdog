import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { NetworkEventType, IncidentCategory, IncidentSeverity } from '@prisma/client'

export const runtime = 'edge'
export const preferredRegion = ['iad1', 'fra1', 'sin1']

interface DdosSignals {
  // Latency variance across regions (coefficient of variation)
  latencyVariance: number
  
  // Timeout rate vs baseline
  timeoutRate: number
  timeoutBaseline: number
  timeoutSpike: number
  
  // Region failure ratio
  regionFailureRatio: number
  
  // Error rate increases
  errorRate429: number
  errorRate5xx: number
  errorRateSpike: number
  
  // Failure acceleration (rate of change)
  failureAcceleration: number
  
  // Partial availability pattern
  partialAvailabilityScore: number
}

interface DetectionResult {
  isDdosSuspected: boolean
  isNetworkDegradation: boolean
  isPacketLoss: boolean
  confidence: number
  signals: DdosSignals
  description: string
}

async function analyzeTrafficPatterns(monitorId: string): Promise<DetectionResult> {
  const now = new Date()
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

  // Get recent checks (last 5 minutes)
  const recentChecks = await prisma.monitorCheck.findMany({
    where: {
      monitorId,
      timestamp: { gte: fiveMinutesAgo },
    },
    include: { region: true },
    orderBy: { timestamp: 'desc' },
  })

  // Get baseline checks (1 hour ago, 5-minute window)
  const baselineStart = new Date(oneHourAgo.getTime() - 5 * 60 * 1000)
  const baselineChecks = await prisma.monitorCheck.findMany({
    where: {
      monitorId,
      timestamp: {
        gte: baselineStart,
        lte: oneHourAgo,
      },
    },
    include: { region: true },
  })

  // Calculate metrics
  const recentTotal = recentChecks.length
  const baselineTotal = baselineChecks.length

  if (recentTotal === 0) {
    return {
      isDdosSuspected: false,
      isNetworkDegradation: false,
      isPacketLoss: false,
      confidence: 0,
      signals: {} as DdosSignals,
      description: 'No recent checks available',
    }
  }

  // Timeout analysis
  const recentTimeouts = recentChecks.filter(c => c.status === 'TIMEOUT').length
  const baselineTimeouts = baselineChecks.filter(c => c.status === 'TIMEOUT').length
  const timeoutRate = recentTotal > 0 ? recentTimeouts / recentTotal : 0
  const timeoutBaseline = baselineTotal > 0 ? baselineTimeouts / baselineTotal : 0.01 // Minimum 1%
  const timeoutSpike = timeoutBaseline > 0 ? timeoutRate / timeoutBaseline : timeoutRate * 100

  // Error code analysis
  const recent429s = recentChecks.filter(c => c.statusCode === 429).length
  const recent5xxs = recentChecks.filter(c => c.statusCode && c.statusCode >= 500).length
  const errorRate429 = recentTotal > 0 ? recent429s / recentTotal : 0
  const errorRate5xx = recentTotal > 0 ? recent5xxs / recentTotal : 0

  const baselineErrors = baselineChecks.filter(c => c.statusCode && c.statusCode >= 400).length
  const baselineErrorRate = baselineTotal > 0 ? baselineErrors / baselineTotal : 0.01
  const currentErrorRate = recentTotal > 0 ? (recent429s + recent5xxs) / recentTotal : 0
  const errorRateSpike = baselineErrorRate > 0 ? currentErrorRate / baselineErrorRate : currentErrorRate * 100

  // Region analysis
  const regions = new Set(recentChecks.map(c => c.regionId))
  const regionStats: Record<string, { total: number; failures: number }> = {}
  
  regions.forEach(regionId => {
    regionStats[regionId] = { total: 0, failures: 0 }
  })

  recentChecks.forEach(check => {
    regionStats[check.regionId].total++
    if (check.status !== 'UP') {
      regionStats[check.regionId].failures++
    }
  })

  const failedRegions = Object.values(regionStats).filter(r => r.failures / r.total > 0.5).length
  const regionFailureRatio = Object.keys(regionStats).length > 0 
    ? failedRegions / Object.keys(regionStats).length 
    : 0

  // Latency variance (coefficient of variation)
  const responseTimes = recentChecks
    .filter(c => c.responseTime && c.responseTime > 0)
    .map(c => c.responseTime)

  let latencyVariance = 0
  if (responseTimes.length > 1) {
    const mean = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    const variance = responseTimes.reduce((sum, rt) => sum + Math.pow(rt - mean, 2), 0) / responseTimes.length
    const stdDev = Math.sqrt(variance)
    latencyVariance = mean > 0 ? stdDev / mean : 0
  }

  // Failure acceleration (compare recent 2 min vs previous 3 min)
  const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000)
  const veryRecent = recentChecks.filter(c => c.timestamp >= twoMinutesAgo)
  const lessRecent = recentChecks.filter(c => c.timestamp < twoMinutesAgo)

  const veryRecentFailures = veryRecent.filter(c => c.status !== 'UP').length
  const lessRecentFailures = lessRecent.filter(c => c.status !== 'UP').length

  const veryRecentRate = veryRecent.length > 0 ? veryRecentFailures / veryRecent.length : 0
  const lessRecentRate = lessRecent.length > 0 ? lessRecentFailures / lessRecent.length : 0

  const failureAcceleration = lessRecentRate > 0 
    ? veryRecentRate / lessRecentRate 
    : veryRecentRate * 10

  // Partial availability score
  const partialAvailabilityScore = regionFailureRatio > 0 && regionFailureRatio < 1 
    ? regionFailureRatio 
    : 0

  const signals: DdosSignals = {
    latencyVariance,
    timeoutRate,
    timeoutBaseline,
    timeoutSpike,
    regionFailureRatio,
    errorRate429,
    errorRate5xx,
    errorRateSpike,
    failureAcceleration,
    partialAvailabilityScore,
  }

  // Detection heuristics
  let isDdosSuspected = false
  let isNetworkDegradation = false
  let isPacketLoss = false
  let confidence = 0
  const indicators: string[] = []

  // DDoS detection
  if (errorRate429 > 0.1 || errorRateSpike > 5) {
    isDdosSuspected = true
    confidence += 0.3
    indicators.push('Rate limiting responses detected')
  }

  if (timeoutSpike > 5 && regionFailureRatio > 0.5) {
    isDdosSuspected = true
    confidence += 0.25
    indicators.push('Timeout surge across multiple regions')
  }

  if (failureAcceleration > 3 && errorRate5xx > 0.2) {
    isDdosSuspected = true
    confidence += 0.25
    indicators.push('Rapid failure increase with server errors')
  }

  // Network degradation
  if (latencyVariance > 0.5 && timeoutRate > 0.1) {
    isNetworkDegradation = true
    confidence += 0.2
    indicators.push('High latency variance with timeouts')
  }

  // Packet loss detection
  if (partialAvailabilityScore > 0.3 && partialAvailabilityScore < 0.8) {
    isPacketLoss = true
    confidence += 0.2
    indicators.push('Partial availability pattern')
  }

  if (timeoutRate > 0.3 && timeoutRate < 0.8) {
    isPacketLoss = true
    confidence += 0.15
    indicators.push('Intermittent timeouts suggesting packet loss')
  }

  // Cap confidence at 0.95
  confidence = Math.min(confidence, 0.95)

  let description = 'No anomalies detected'
  if (isDdosSuspected) {
    description = `Possible DDoS attack detected. ${indicators.join('. ')}`
  } else if (isPacketLoss) {
    description = `Packet loss detected. ${indicators.join('. ')}`
  } else if (isNetworkDegradation) {
    description = `Network degradation detected. ${indicators.join('. ')}`
  }

  return {
    isDdosSuspected,
    isNetworkDegradation,
    isPacketLoss,
    confidence,
    signals,
    description,
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { monitorId } = body

    if (!monitorId) {
      return NextResponse.json(
        { error: 'Missing monitorId' },
        { status: 400 }
      )
    }

    const monitor = await prisma.monitor.findUnique({
      where: { id: monitorId },
    })

    if (!monitor) {
      return NextResponse.json(
        { error: 'Monitor not found' },
        { status: 404 }
      )
    }

    const detection = await analyzeTrafficPatterns(monitorId)

    // Store network event if anomaly detected
    if (detection.isDdosSuspected || detection.isNetworkDegradation || detection.isPacketLoss) {
      let eventType: NetworkEventType
      if (detection.isDdosSuspected) {
        eventType = NetworkEventType.DDOS_HEURISTIC
      } else if (detection.isPacketLoss) {
        eventType = NetworkEventType.PACKET_LOSS
      } else {
        eventType = NetworkEventType.LATENCY_SPIKE
      }

      await prisma.networkEvent.create({
        data: {
          monitorId,
          eventType,
          confidence: detection.confidence,
          signals: detection.signals as any,
          description: detection.description,
        },
      })

      // Check if we should create/update an incident
      await handleAnomalyIncident(monitorId, detection)
    }

    return NextResponse.json({
      success: true,
      detection: {
        isDdosSuspected: detection.isDdosSuspected,
        isNetworkDegradation: detection.isNetworkDegradation,
        isPacketLoss: detection.isPacketLoss,
        confidence: detection.confidence,
        description: detection.description,
      },
    })
  } catch (error) {
    console.error('DDoS detection error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

async function handleAnomalyIncident(monitorId: string, detection: DetectionResult) {
  try {
    // Find existing open incident
    const openIncident = await prisma.incident.findFirst({
      where: {
        monitorId,
        resolvedAt: null,
      },
    })

    let category: IncidentCategory
    if (detection.isDdosSuspected) {
      category = IncidentCategory.DDOS_SUSPICION
    } else if (detection.isPacketLoss) {
      category = IncidentCategory.PACKET_LOSS
    } else {
      category = IncidentCategory.NETWORK_ISSUE
    }

    if (openIncident) {
      // Update existing incident if confidence is higher
      if (detection.confidence > 0.7 && openIncident.category !== category) {
        await prisma.incident.update({
          where: { id: openIncident.id },
          data: {
            category,
            description: `${openIncident.description}\n\nUpdated: ${detection.description}`,
          },
        })
      }
    } else if (detection.confidence > 0.6) {
      // Create new incident
      await prisma.incident.create({
        data: {
          monitorId,
          severity: detection.isDdosSuspected ? IncidentSeverity.CRITICAL : IncidentSeverity.WARNING,
          category,
          title: detection.isDdosSuspected 
            ? 'Possible DDoS attack detected'
            : detection.isPacketLoss 
              ? 'Packet loss detected'
              : 'Network degradation detected',
          description: detection.description,
        },
      })
    }
  } catch (error) {
    console.error('Handle anomaly incident error:', error)
  }
}
