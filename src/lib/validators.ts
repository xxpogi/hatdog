import { z } from 'zod'
import { MonitorType, HttpMethod, Region, TeamRole, AlertChannel, AlertEvent, SloMetricType, PanelType } from '@prisma/client'

// Auth validators
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export const signupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

// Team validators
export const createTeamSchema = z.object({
  name: z.string().min(2, 'Team name must be at least 2 characters'),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
})

export const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.nativeEnum(TeamRole),
})

export const updateMemberRoleSchema = z.object({
  memberId: z.string(),
  role: z.nativeEnum(TeamRole),
})

// Project validators
export const createProjectSchema = z.object({
  name: z.string().min(2, 'Project name must be at least 2 characters'),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
  description: z.string().optional(),
  isPublic: z.boolean().default(false),
})

// Monitor validators
export const createMonitorSchema = z.object({
  name: z.string().min(2, 'Monitor name must be at least 2 characters'),
  url: z.string().url('Invalid URL'),
  type: z.nativeEnum(MonitorType).default(MonitorType.HTTP),
  method: z.nativeEnum(HttpMethod).default(HttpMethod.GET),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().optional(),
  interval: z.number().min(30).max(3600).default(60),
  timeout: z.number().min(5).max(60).default(30),
  expectedStatus: z.number().min(100).max(599).optional(),
  expectedBody: z.string().optional(),
  followRedirects: z.boolean().default(true),
  verifySsl: z.boolean().default(true),
  regions: z.array(z.nativeEnum(Region)).min(1, 'Select at least one region'),
})

export const updateMonitorSchema = createMonitorSchema.partial()

// Alert config validators
export const createAlertConfigSchema = z.object({
  name: z.string().min(2),
  channelType: z.nativeEnum(AlertChannel),
  config: z.object({
    webhook: z.object({
      url: z.string().url(),
      secret: z.string().optional(),
    }).optional(),
    discord: z.object({
      webhookUrl: z.string().url(),
    }).optional(),
    slack: z.object({
      webhookUrl: z.string().url(),
    }).optional(),
    email: z.object({
      addresses: z.array(z.string().email()),
    }).optional(),
  }),
  events: z.array(z.nativeEnum(AlertEvent)).min(1),
})

// SLO validators
export const createSloSchema = z.object({
  name: z.string().min(2),
  target: z.number().min(0).max(1),
  metricType: z.nativeEnum(SloMetricType),
  threshold: z.number().min(1),
  windowDays: z.number().min(1).max(90),
})

// Dashboard validators
export const createDashboardSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  layout: z.object({
    columns: z.number().default(12),
    rowHeight: z.number().default(80),
  }).default({ columns: 12, rowHeight: 80 }),
})

export const dashboardPanelSchema = z.object({
  title: z.string().min(1),
  type: z.nativeEnum(PanelType),
  config: z.record(z.string(), z.any()),
  position: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  }),
  query: z.object({
    monitorId: z.string().optional(),
    metric: z.string(),
    aggregation: z.enum(['avg', 'sum', 'min', 'max', 'count']),
    timeRange: z.number(),
  }),
  refreshRate: z.number().optional(),
})

// Types
export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>
export type CreateTeamInput = z.infer<typeof createTeamSchema>
export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type CreateMonitorInput = z.infer<typeof createMonitorSchema>
export type CreateAlertConfigInput = z.infer<typeof createAlertConfigSchema>
export type CreateSloInput = z.infer<typeof createSloSchema>
export type CreateDashboardInput = z.infer<typeof createDashboardSchema>
export type DashboardPanelInput = z.infer<typeof dashboardPanelSchema>
