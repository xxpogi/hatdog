import { TeamRole } from '@prisma/client'
import { prisma } from './prisma'

export type Permission = 
  | 'team:read' | 'team:update' | 'team:delete' | 'team:manage_members'
  | 'project:create' | 'project:read' | 'project:update' | 'project:delete'
  | 'monitor:create' | 'monitor:read' | 'monitor:update' | 'monitor:delete'
  | 'dashboard:create' | 'dashboard:read' | 'dashboard:update' | 'dashboard:delete'
  | 'alert:create' | 'alert:read' | 'alert:update' | 'alert:delete'
  | 'slo:create' | 'slo:read' | 'slo:update' | 'slo:delete'
  | 'incident:read' | 'incident:update'
  | 'audit:read'

const ROLE_PERMISSIONS: Record<TeamRole, Permission[]> = {
  [TeamRole.OWNER]: [
    'team:read', 'team:update', 'team:delete', 'team:manage_members',
    'project:create', 'project:read', 'project:update', 'project:delete',
    'monitor:create', 'monitor:read', 'monitor:update', 'monitor:delete',
    'dashboard:create', 'dashboard:read', 'dashboard:update', 'dashboard:delete',
    'alert:create', 'alert:read', 'alert:update', 'alert:delete',
    'slo:create', 'slo:read', 'slo:update', 'slo:delete',
    'incident:read', 'incident:update', 'audit:read',
  ],
  [TeamRole.ADMIN]: [
    'team:read', 'team:update', 'team:manage_members',
    'project:create', 'project:read', 'project:update', 'project:delete',
    'monitor:create', 'monitor:read', 'monitor:update', 'monitor:delete',
    'dashboard:create', 'dashboard:read', 'dashboard:update', 'dashboard:delete',
    'alert:create', 'alert:read', 'alert:update', 'alert:delete',
    'slo:create', 'slo:read', 'slo:update', 'slo:delete',
    'incident:read', 'incident:update', 'audit:read',
  ],
  [TeamRole.MEMBER]: [
    'team:read', 'project:read',
    'monitor:create', 'monitor:read', 'monitor:update',
    'dashboard:create', 'dashboard:read', 'dashboard:update',
    'alert:create', 'alert:read', 'alert:update',
    'slo:read', 'incident:read',
  ],
  [TeamRole.VIEWER]: [
    'team:read', 'project:read', 'monitor:read',
    'dashboard:read', 'alert:read', 'slo:read', 'incident:read',
  ],
}

export function hasPermission(role: TeamRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

export async function getTeamMembership(userId: string, teamId: string) {
  return prisma.teamMember.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId,
      },
    },
    include: { team: true },
  })
}

export async function checkPermission(
  userId: string,
  teamId: string,
  permission: Permission
): Promise<boolean> {
  const membership = await getTeamMembership(userId, teamId)
  if (!membership) return false
  return hasPermission(membership.role, permission)
}

export async function requirePermission(
  userId: string,
  teamId: string,
  permission: Permission
): Promise<void> {
  const hasAccess = await checkPermission(userId, teamId, permission)
  if (!hasAccess) {
    throw new Error(`Forbidden: Missing permission ${permission}`)
  }
}

export function getRoleLabel(role: TeamRole): string {
  const labels = {
    [TeamRole.OWNER]: 'Owner',
    [TeamRole.ADMIN]: 'Admin',
    [TeamRole.MEMBER]: 'Member',
    [TeamRole.VIEWER]: 'Viewer',
  }
  return labels[role]
}

export function canManageRole(userRole: TeamRole, targetRole: TeamRole): boolean {
  const hierarchy = {
    [TeamRole.OWNER]: 4,
    [TeamRole.ADMIN]: 3,
    [TeamRole.MEMBER]: 2,
    [TeamRole.VIEWER]: 1,
  }
  return hierarchy[userRole] > hierarchy[targetRole]
}
