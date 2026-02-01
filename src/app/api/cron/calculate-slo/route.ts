import { NextRequest, NextResponse } from 'next/server'
import { calculateAllSlos } from '@/app/_actions/slo.actions'

export const runtime = 'edge'

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await calculateAllSlos()
    return NextResponse.json(result)
  } catch (error) {
    console.error('SLO calculation cron error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
