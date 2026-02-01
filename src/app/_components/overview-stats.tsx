'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Monitor,
  Activity,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { subDays } from 'date-fns'

interface OverviewStatsProps {
  teamId: string
}

interface Stats {
  totalMonitors: number
  upMonitors: number
  downMonitors: number
  totalIncidents: number
  openIncidents: number
  avgUptime: number
  avgLatency: number
}

export function OverviewStats({ teamId }: OverviewStatsProps) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      try {
        // Get all projects for this team
        const projects = await prisma.project.findMany({
          where: { teamId },
          include: {
            monitors: {
              where: { deletedAt: null, isEnabled: true },
              include: {
                checks: {
                  where: {
                    timestamp: { gte: subDays(new Date(), 1) },
                  },
                  orderBy: { timestamp: 'desc' },
                  take: 1,
                },
                incidents: {
                  where: { resolvedAt: null },
                },
              },
            },
          },
        })

        const allMonitors = projects.flatMap(p => p.monitors)

        // Calculate stats
        const totalMonitors = allMonitors.length
        const upMonitors = allMonitors.filter(m => m.checks[0]?.status === 'UP').length
        const downMonitors = allMonitors.filter(
          m => m.checks[0]?.status === 'DOWN' || m.checks[0]?.status === 'TIMEOUT'
        ).length

        // Get incidents
        const incidents = await prisma.incident.findMany({
          where: {
            monitor: {
              project: { teamId },
            },
            startedAt: { gte: subDays(new Date(), 30) },
          },
        })

        const totalIncidents = incidents.length
        const openIncidents = incidents.filter(i => !i.resolvedAt).length

        // Calculate average uptime
        const uptimeChecks = await prisma.monitorCheck.findMany({
          where: {
            monitor: {
              project: { teamId },
              deletedAt: null,
            },
            timestamp: { gte: subDays(new Date(), 1) },
          },
        })

        const upCount = uptimeChecks.filter(c => c.status === 'UP').length
        const avgUptime = uptimeChecks.length > 0 ? (upCount / uptimeChecks.length) * 100 : 100

        // Calculate average latency
        const latencyChecks = uptimeChecks.filter(c => c.status === 'UP' && c.responseTime)
        const avgLatency =
          latencyChecks.length > 0
            ? latencyChecks.reduce((sum, c) => sum + c.responseTime, 0) / latencyChecks.length
            : 0

        setStats({
          totalMonitors,
          upMonitors,
          downMonitors,
          totalIncidents,
          openIncidents,
          avgUptime,
          avgLatency,
        })
      } catch (error) {
        console.error('Error fetching stats:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [teamId])

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="bg-card border border-border rounded-xl p-6 animate-pulse"
          >
            <div className="h-10 w-10 bg-muted rounded-lg mb-4" />
            <div className="h-8 w-24 bg-muted rounded mb-2" />
            <div className="h-4 w-16 bg-muted rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (!stats) return null

  const statCards = [
    {
      title: 'Total Monitors',
      value: stats.totalMonitors,
      icon: Monitor,
      trend: null,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
    },
    {
      title: 'System Health',
      value: `${stats.avgUptime.toFixed(2)}%`,
      icon: Activity,
      trend: stats.avgUptime >= 99 ? 'up' : stats.avgUptime >= 95 ? 'neutral' : 'down',
      color: stats.avgUptime >= 99 ? 'text-green-500' : stats.avgUptime >= 95 ? 'text-yellow-500' : 'text-red-500',
      bgColor: stats.avgUptime >= 99 ? 'bg-green-500/10' : stats.avgUptime >= 95 ? 'bg-yellow-500/10' : 'bg-red-500/10',
    },
    {
      title: 'Open Incidents',
      value: stats.openIncidents,
      icon: AlertTriangle,
      trend: stats.openIncidents > 0 ? 'down' : 'up',
      color: stats.openIncidents > 0 ? 'text-red-500' : 'text-green-500',
      bgColor: stats.openIncidents > 0 ? 'bg-red-500/10' : 'bg-green-500/10',
    },
    {
      title: 'Avg Latency',
      value: `${Math.round(stats.avgLatency)}ms`,
      icon: TrendingUp,
      trend: stats.avgLatency < 200 ? 'up' : stats.avgLatency < 500 ? 'neutral' : 'down',
      color: stats.avgLatency < 200 ? 'text-green-500' : stats.avgLatency < 500 ? 'text-yellow-500' : 'text-red-500',
      bgColor: stats.avgLatency < 200 ? 'bg-green-500/10' : stats.avgLatency < 500 ? 'bg-yellow-500/10' : 'bg-red-500/10',
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {statCards.map((stat, index) => {
        const Icon = stat.icon
        const TrendIcon = stat.trend === 'up' ? TrendingUp : stat.trend === 'down' ? TrendingDown : Minus

        return (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="bg-card border border-border rounded-xl p-6 hover:border-primary/50 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className={`w-10 h-10 ${stat.bgColor} rounded-lg flex items-center justify-center`}>
                <Icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              {stat.trend && (
                <div className={`flex items-center gap-1 text-xs ${
                  stat.trend === 'up' ? 'text-green-500' : stat.trend === 'down' ? 'text-red-500' : 'text-muted-foreground'
                }`}>
                  <TrendIcon className="w-3 h-3" />
                </div>
              )}
            </div>
            <div className="mt-4">
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-sm text-muted-foreground">{stat.title}</p>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
