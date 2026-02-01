import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'edge'

// This endpoint is called by Vercel Cron every minute
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Get all enabled monitors that are due for a check
    const now = new Date()
    
    const monitors = await prisma.monitor.findMany({
      where: {
        isEnabled: true,
        deletedAt: null,
      },
      include: {
        regions: {
          where: { isEnabled: true },
        },
        project: {
          include: {
            team: true,
          },
        },
      },
    })

    // Filter monitors that are due (based on interval)
    const dueMonitors = monitors.filter(monitor => {
      // For now, check all monitors every minute
      // In production, you'd track last check time per monitor
      return true
    })

    const results = []
    const errors = []

    // Trigger checks for each monitor region
    for (const monitor of dueMonitors) {
      for (const region of monitor.regions) {
        try {
          // Determine which edge region to use
          const edgeRegion = getEdgeRegion(region.region)
          
          // Call the edge monitor endpoint
          const checkUrl = `https://${process.env.VERCEL_URL || 'localhost:3000'}/api/edge/monitor`
          
          const response = await fetch(checkUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              monitorId: monitor.id,
              regionId: region.id,
            }),
          })

          if (!response.ok) {
            errors.push({
              monitorId: monitor.id,
              regionId: region.id,
              error: `HTTP ${response.status}`,
            })
          } else {
            const result = await response.json()
            results.push({
              monitorId: monitor.id,
              regionId: region.id,
              status: result.check?.status,
              responseTime: result.check?.responseTime,
            })
          }
        } catch (error) {
          errors.push({
            monitorId: monitor.id,
            regionId: region.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }

      // Run DDoS detection periodically (every 5 minutes)
      const shouldRunDdosDetection = now.getMinutes() % 5 === 0
      if (shouldRunDdosDetection) {
        try {
          const ddosUrl = `https://${process.env.VERCEL_URL || 'localhost:3000'}/api/edge/ddos-detect`
          await fetch(ddosUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ monitorId: monitor.id }),
          })
        } catch (error) {
          console.error(`DDoS detection failed for monitor ${monitor.id}:`, error)
        }
      }
    }

    return NextResponse.json({
      success: true,
      checked: results.length,
      errors: errors.length,
      results,
      errors_detail: errors,
    })
  } catch (error) {
    console.error('Cron check error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

function getEdgeRegion(region: string): string {
  const regionMap: Record<string, string> = {
    'US_EAST': 'iad1',
    'US_WEST': 'sfo1',
    'EU_WEST': 'fra1',
    'EU_CENTRAL': 'arn1',
    'ASIA_SE': 'sin1',
    'ASIA_NE': 'hnd1',
  }
  return regionMap[region] || 'iad1'
}
