'use server'

import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { requirePermission } from '@/lib/rbac'
import { createAlertConfigSchema } from '@/lib/validators'
import { revalidatePath } from 'next/cache'


// Alert delivery functions
async function sendDiscordWebhook(url: string, payload: any): Promise<{ success: boolean; response?: string }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      return { success: false, response: `HTTP ${response.status}` }
    }

    return { success: true }
  } catch (error) {
    return { success: false, response: error instanceof Error ? error.message : 'Unknown error' }
  }
}

async function sendSlackWebhook(url: string, payload: any): Promise<{ success: boolean; response?: string }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      return { success: false, response: `HTTP ${response.status}` }
    }

    return { success: true }
  } catch (error) {
    return { success: false, response: error instanceof Error ? error.message : 'Unknown error' }
  }
}

async function sendGenericWebhook(url: string, payload: any, secret?: string): Promise<{ success: boolean; response?: string }> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (secret) {
      // Use Web Crypto API for edge compatibility
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      )
      const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(JSON.stringify(payload))
      )
      const signatureHex = Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
      headers['X-Webhook-Signature'] = `sha256=${signatureHex}`
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      return { success: false, response: `HTTP ${response.status}` }
    }

    return { success: true }
  } catch (error) {
    return { success: false, response: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Build alert payloads
function buildDiscordEmbed(alert: any, incident: any, monitor: any) {
  const colorMap: Record<string, number> = {
    DOWNTIME: 0xff0000,      // Red
    RECOVERY: 0x00ff00,      // Green
    ANOMALY: 0xffa500,       // Orange
    DDOS_DETECTED: 0xff00ff, // Magenta
    SLO_BREACH: 0xffff00,    // Yellow
    DEGRADATION: 0x808080,   // Gray
  }

  return {
    embeds: [{
      title: `🚨 ${alert.eventType}`,
      description: incident?.title || 'Alert triggered',
      color: colorMap[alert.eventType] || 0x808080,
      fields: [
        {
          name: 'Monitor',
          value: monitor?.name || 'Unknown',
          inline: true,
        },
        {
          name: 'URL',
          value: monitor?.url || 'N/A',
          inline: true,
        },
        {
          name: 'Time',
          value: new Date().toISOString(),
          inline: false,
        },
        ...(incident?.description ? [{
          name: 'Details',
          value: incident.description.slice(0, 1024),
          inline: false,
        }] : []),
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Observability Platform',
      },
    }],
  }
}

function buildSlackPayload(alert: any, incident: any, monitor: any) {
  const colorMap: Record<string, string> = {
    DOWNTIME: 'danger',
    RECOVERY: 'good',
    ANOMALY: 'warning',
    DDOS_DETECTED: 'danger',
    SLO_BREACH: 'warning',
    DEGRADATION: '#808080',
  }

  return {
    attachments: [{
      color: colorMap[alert.eventType] || '#808080',
      title: `🚨 ${alert.eventType}`,
      text: incident?.title || 'Alert triggered',
      fields: [
        {
          title: 'Monitor',
          value: monitor?.name || 'Unknown',
          short: true,
        },
        {
          title: 'URL',
          value: monitor?.url || 'N/A',
          short: true,
        },
        {
          title: 'Time',
          value: new Date().toISOString(),
          short: false,
        },
      ],
      footer: 'Observability Platform',
      ts: Math.floor(Date.now() / 1000),
    }],
  }
}

function buildGenericPayload(alert: any, incident: any, monitor: any) {
  return {
    event: alert.eventType,
    timestamp: new Date().toISOString(),
    monitor: {
      id: monitor?.id,
      name: monitor?.name,
      url: monitor?.url,
    },
    incident: incident ? {
      id: incident.id,
      title: incident.title,
      description: incident.description,
      severity: incident.severity,
      category: incident.category,
      startedAt: incident.startedAt,
    } : null,
  }
}

// Main alert dispatch function
export async function dispatchAlert(incidentId: string, eventType: string) {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        monitor: {
          include: {
            alertConfigs: {
              where: { isEnabled: true },
            },
          },
        },
      },
    })

    if (!incident) {
      return { error: 'Incident not found' }
    }

    const { monitor } = incident
    const configs = monitor.alertConfigs.filter(config =>
      (config.events as string[]).includes(eventType)
    )

    const results = []

    for (const config of configs) {
      const alert = await prisma.alert.create({
        data: {
          configId: config.id,
          incidentId,
          status: 'PENDING',
          payload: {},
        },
      })

      let result: { success: boolean; response?: string }
      const configData = config.config as any

      switch (config.channelType) {
        case 'DISCORD':
          if (configData.discord?.webhookUrl) {
            const payload = buildDiscordEmbed({ eventType }, incident, monitor)
            result = await sendDiscordWebhook(configData.discord.webhookUrl, payload)
          } else {
            result = { success: false, response: 'Missing Discord webhook URL' }
          }
          break

        case 'SLACK':
          if (configData.slack?.webhookUrl) {
            const payload = buildSlackPayload({ eventType }, incident, monitor)
            result = await sendSlackWebhook(configData.slack.webhookUrl, payload)
          } else {
            result = { success: false, response: 'Missing Slack webhook URL' }
          }
          break

        case 'WEBHOOK':
          if (configData.webhook?.url) {
            const payload = buildGenericPayload({ eventType }, incident, monitor)
            result = await sendGenericWebhook(
              configData.webhook.url,
              payload,
              configData.webhook.secret
            )
          } else {
            result = { success: false, response: 'Missing webhook URL' }
          }
          break

        default:
          result = { success: false, response: 'Unsupported channel type' }
      }

      await prisma.alert.update({
        where: { id: alert.id },
        data: {
          status: result.success ? 'SENT' : 'FAILED',
          response: result.response,
          payload: buildGenericPayload({ eventType }, incident, monitor),
        },
      })

      results.push({
        configId: config.id,
        channelType: config.channelType,
        success: result.success,
        response: result.response,
      })
    }

    return { success: true, results }
  } catch (error) {
    console.error('Dispatch alert error:', error)
    return { error: 'Failed to dispatch alerts' }
  }
}

// Server Actions for alert configuration
export async function getAlertConfigs(monitorId: string) {
  const user = await requireAuth()

  const monitor = await prisma.monitor.findUnique({
    where: { id: monitorId },
    include: {
      project: {
        include: {
          team: { include: { members: true } },
        },
      },
    },
  })

  if (!monitor) return []

  const isMember = monitor.project.team.members.some(m => m.userId === user.id)
  if (!isMember) return []

  return prisma.alertConfig.findMany({
    where: { monitorId },
    include: {
      _count: { select: { alerts: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createAlertConfig(monitorId: string, formData: FormData) {
  try {
    const user = await requireAuth()

    const monitor = await prisma.monitor.findUnique({
      where: { id: monitorId },
      include: {
        project: { include: { team: true } },
      },
    })

    if (!monitor) {
      return { error: 'Monitor not found' }
    }

    await requirePermission(user.id, monitor.project.teamId, 'alert:create')

    const name = formData.get('name') as string
    const channelType = formData.get('channelType') as string
    const configJson = formData.get('config') as string
    const eventsJson = formData.get('events') as string

    const config = JSON.parse(configJson)
    const events = JSON.parse(eventsJson)

    const validated = createAlertConfigSchema.parse({
      name,
      channelType,
      config,
      events,
    })

    const alertConfig = await prisma.alertConfig.create({
      data: {
        name: validated.name,
        channelType: validated.channelType,
        config: validated.config,
        events: validated.events,
        monitorId,
      },
    })

    revalidatePath(`/monitors/${monitorId}/alerts`)
    return { success: true, alertConfig }
  } catch (error) {
    console.error('Create alert config error:', error)
    return { error: 'Failed to create alert configuration' }
  }
}

export async function updateAlertConfig(configId: string, formData: FormData) {
  try {
    const user = await requireAuth()

    const config = await prisma.alertConfig.findUnique({
      where: { id: configId },
      include: {
        monitor: {
          include: {
            project: { include: { team: true } },
          },
        },
      },
    })

    if (!config) {
      return { error: 'Alert config not found' }
    }

    await requirePermission(user.id, config.monitor.project.teamId, 'alert:update')

    const isEnabled = formData.get('isEnabled') === 'true'

    const updated = await prisma.alertConfig.update({
      where: { id: configId },
      data: { isEnabled },
    })

    revalidatePath(`/monitors/${config.monitorId}/alerts`)
    return { success: true, alertConfig: updated }
  } catch (error) {
    console.error('Update alert config error:', error)
    return { error: 'Failed to update alert configuration' }
  }
}

export async function deleteAlertConfig(configId: string) {
  try {
    const user = await requireAuth()

    const config = await prisma.alertConfig.findUnique({
      where: { id: configId },
      include: {
        monitor: {
          include: {
            project: { include: { team: true } },
          },
        },
      },
    })

    if (!config) {
      return { error: 'Alert config not found' }
    }

    await requirePermission(user.id, config.monitor.project.teamId, 'alert:delete')

    await prisma.alertConfig.delete({
      where: { id: configId },
    })

    revalidatePath(`/monitors/${config.monitorId}/alerts`)
    return { success: true }
  } catch (error) {
    console.error('Delete alert config error:', error)
    return { error: 'Failed to delete alert configuration' }
  }
}

export async function testAlertConfig(configId: string) {
  try {
    const user = await requireAuth()

    const config = await prisma.alertConfig.findUnique({
      where: { id: configId },
      include: {
        monitor: {
          include: {
            project: { include: { team: true } },
          },
        },
      },
    })

    if (!config) {
      return { error: 'Alert config not found' }
    }

    await requirePermission(user.id, config.monitor.project.teamId, 'alert:update')

    // Send test alert
    const testPayload = {
      event: 'TEST',
      timestamp: new Date().toISOString(),
      message: 'This is a test alert from Observability Platform',
      monitor: {
        id: config.monitor.id,
        name: config.monitor.name,
        url: config.monitor.url,
      },
    }

    let result: { success: boolean; response?: string }
    const configData = config.config as any

    switch (config.channelType) {
      case 'DISCORD':
        if (configData.discord?.webhookUrl) {
          result = await sendDiscordWebhook(configData.discord.webhookUrl, {
            embeds: [{
              title: '🧪 Test Alert',
              description: 'This is a test alert from Observability Platform',
              color: 0x00ffff,
              fields: [
                { name: 'Monitor', value: config.monitor.name, inline: true },
                { name: 'Config', value: config.name, inline: true },
              ],
              timestamp: new Date().toISOString(),
            }],
          })
        } else {
          result = { success: false, response: 'Missing Discord webhook URL' }
        }
        break

      case 'SLACK':
        if (configData.slack?.webhookUrl) {
          result = await sendSlackWebhook(configData.slack.webhookUrl, {
            attachments: [{
              color: 'good',
              title: '🧪 Test Alert',
              text: 'This is a test alert from Observability Platform',
              fields: [
                { title: 'Monitor', value: config.monitor.name, short: true },
                { title: 'Config', value: config.name, short: true },
              ],
            }],
          })
        } else {
          result = { success: false, response: 'Missing Slack webhook URL' }
        }
        break

      case 'WEBHOOK':
        if (configData.webhook?.url) {
          result = await sendGenericWebhook(
            configData.webhook.url,
            testPayload,
            configData.webhook.secret
          )
        } else {
          result = { success: false, response: 'Missing webhook URL' }
        }
        break

      default:
        result = { success: false, response: 'Unsupported channel type' }
    }

    return {
      success: result.success,
      message: result.success ? 'Test alert sent successfully' : `Failed: ${result.response}`,
    }
  } catch (error) {
    console.error('Test alert error:', error)
    return { error: 'Failed to send test alert' }
  }
}
