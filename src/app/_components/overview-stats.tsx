'use client'
import { motion } from 'framer-motion'
import {
  Monitor,
  Activity,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react'

interface OverviewStatsProps {
  stats: Stats | null
}

export interface Stats {
  totalMonitors: number
  upMonitors: number
  downMonitors: number
  totalIncidents: number
  openIncidents: number
  avgUptime: number
  avgLatency: number
}

export function OverviewStats({ stats }: OverviewStatsProps) {
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
