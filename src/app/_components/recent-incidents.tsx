'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  Clock,
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react'
import { IncidentSeverity } from '@prisma/client'

interface RecentIncidentsProps {
  teamId: string
}

interface Incident {
  id: string
  title: string
  severity: IncidentSeverity
  category: string
  startedAt: string
  resolvedAt: string | null
  duration: number | null
  monitor: {
    name: string
  }
}

const severityConfig: Record<IncidentSeverity, { icon: any; className: string; label: string }> = {
  CRITICAL: { icon: XCircle, className: 'severity-critical', label: 'Critical' },
  WARNING: { icon: AlertCircle, className: 'severity-warning', label: 'Warning' },
  INFO: { icon: CheckCircle2, className: 'severity-info', label: 'Info' },
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return 'Ongoing'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatTimeAgo(date: string): string {
  const now = new Date()
  const then = new Date(date)
  const diff = now.getTime() - then.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'Just now'
}

export function RecentIncidents({ teamId }: RecentIncidentsProps) {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchIncidents() {
      try {
        // This would be a real API call in production
        setIncidents([])
      } catch (error) {
        console.error('Error fetching incidents:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchIncidents()
  }, [teamId])

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-5 w-5 bg-muted rounded animate-pulse" />
          <div className="h-6 w-32 bg-muted rounded animate-pulse" />
        </div>
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
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
            <AlertTriangle className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Recent Incidents</h2>
          </div>
          <Link
            href="/incidents"
            className="flex items-center gap-1 text-sm text-primary hover:underline"
          >
            View all
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {incidents.length === 0 ? (
        <div className="p-8 text-center">
          <div className="w-12 h-12 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-6 h-6 text-green-500" />
          </div>
          <h3 className="text-sm font-medium mb-1">All systems operational</h3>
          <p className="text-xs text-muted-foreground">No incidents in the last 30 days</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {incidents.map((incident, index) => {
            const severity = severityConfig[incident.severity]
            const SeverityIcon = severity.icon

            return (
              <motion.div
                key={incident.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: index * 0.05 }}
                className="p-4 hover:bg-muted/50 transition-colors"
              >
                <Link href={`/incidents/${incident.id}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${severity.className}`}>
                      <SeverityIcon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-sm truncate">{incident.title}</h3>
                      <p className="text-xs text-muted-foreground">{incident.monitor.name}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTimeAgo(incident.startedAt)}
                        </span>
                        <span className="flex items-center gap-1">
                          {incident.resolvedAt ? (
                            <>
                              <CheckCircle2 className="w-3 h-3 text-green-500" />
                              Resolved in {formatDuration(incident.duration)}
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3 h-3 text-yellow-500" />
                              Ongoing
                            </>
                          )}
                        </span>
                      </div>
                    </div>
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
