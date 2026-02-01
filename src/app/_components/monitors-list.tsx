'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  Monitor,
  Globe,
  Clock,
  MoreVertical,
  Plus,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Timer,
} from 'lucide-react'
import { CheckStatus } from '@prisma/client'

interface MonitorsListProps {
  teamId: string
}

interface Monitor {
  id: string
  name: string
  url: string
  latestStatus: CheckStatus
  latestResponseTime: number
  uptime24h: number
  regions: { region: string }[]
}

const statusConfig: Record<CheckStatus, { icon: any; className: string; label: string }> = {
  UP: { icon: CheckCircle2, className: 'status-up', label: 'Up' },
  DOWN: { icon: XCircle, className: 'status-down', label: 'Down' },
  DEGRADED: { icon: AlertCircle, className: 'status-degraded', label: 'Degraded' },
  TIMEOUT: { icon: Timer, className: 'status-timeout', label: 'Timeout' },
  ERROR: { icon: XCircle, className: 'status-down', label: 'Error' },
}

export function MonitorsList({ teamId }: MonitorsListProps) {
  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchMonitors() {
      try {
        // This would be a real API call in production
        // For now, we'll use empty data
        setMonitors([])
      } catch (error) {
        console.error('Error fetching monitors:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchMonitors()
  }, [teamId])

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="h-6 w-32 bg-muted rounded animate-pulse" />
          <div className="h-9 w-28 bg-muted rounded animate-pulse" />
        </div>
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-xl">
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Monitor className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Monitors</h2>
          </div>
          <Link
            href="/monitors/new"
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Monitor
          </Link>
        </div>
      </div>

      {monitors.length === 0 ? (
        <div className="p-12 text-center">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
            <Monitor className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium mb-2">No monitors yet</h3>
          <p className="text-muted-foreground mb-4 max-w-sm mx-auto">
            Start monitoring your websites and APIs by adding your first monitor.
          </p>
          <Link
            href="/monitors/new"
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Your First Monitor
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {monitors.map((monitor, index) => {
            const status = statusConfig[monitor.latestStatus]
            const StatusIcon = status.icon

            return (
              <motion.div
                key={monitor.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: index * 0.05 }}
                className="p-4 hover:bg-muted/50 transition-colors"
              >
                <Link href={`/monitors/${monitor.id}`} className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${status.className}`}>
                      <StatusIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-medium">{monitor.name}</h3>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Globe className="w-3 h-3" />
                          {monitor.url}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {monitor.latestResponseTime}ms
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-medium">{monitor.uptime24h.toFixed(2)}%</p>
                      <p className="text-xs text-muted-foreground">24h uptime</p>
                    </div>
                    <div className="flex -space-x-1">
                      {monitor.regions.slice(0, 3).map((region, i) => (
                        <div
                          key={i}
                          className="w-6 h-6 rounded-full bg-muted border-2 border-card flex items-center justify-center text-xs"
                          title={region.region}
                        >
                          {region.region.charAt(0)}
                        </div>
                      ))}
                      {monitor.regions.length > 3 && (
                        <div className="w-6 h-6 rounded-full bg-muted border-2 border-card flex items-center justify-center text-xs">
                          +{monitor.regions.length - 3}
                        </div>
                      )}
                    </div>
                    <button className="p-2 hover:bg-muted rounded-lg transition-colors">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                </Link>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
