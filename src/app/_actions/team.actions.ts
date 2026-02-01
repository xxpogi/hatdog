'use server'

import { prisma } from '@/lib/prisma'
import { getCurrentUser, requireAuth } from '@/lib/auth'
import { requirePermission, checkPermission, canManageRole } from '@/lib/rbac'
import { createTeamSchema, inviteMemberSchema, updateMemberRoleSchema } from '@/lib/validators'
import { revalidatePath } from 'next/cache'
import { TeamRole } from '@prisma/client'

export async function getUserTeams() {
  const user = await requireAuth()

  const memberships = await prisma.teamMember.findMany({
    where: { userId: user.id },
    include: {
      team: {
        include: {
          owner: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
          _count: {
            select: { members: true, projects: true },
          },
        },
      },
    },
    orderBy: { joinedAt: 'desc' },
  })

  return memberships.map(m => ({
    ...m.team,
    role: m.role,
    memberCount: m.team._count.members,
    projectCount: m.team._count.projects,
  }))
}

export async function getTeamBySlug(slug: string) {
  const user = await requireAuth()

  const team = await prisma.team.findUnique({
    where: { slug },
    include: {
      owner: {
        select: { id: true, name: true, email: true, avatarUrl: true },
      },
      members: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
        },
        orderBy: { joinedAt: 'desc' },
      },
      _count: {
        select: { projects: true, members: true },
      },
    },
  })

  if (!team) return null

  // Check if user is a member
  const membership = team.members.find(m => m.userId === user.id)
  if (!membership) return null

  return {
    ...team,
    role: membership.role,
  }
}

export async function createTeam(formData: FormData) {
  try {
    const user = await requireAuth()

    const name = formData.get('name') as string
    const slug = formData.get('slug') as string

    const validated = createTeamSchema.parse({ name, slug })

    // Check if slug is taken
    const existing = await prisma.team.findUnique({
      where: { slug: validated.slug },
    })

    if (existing) {
      return { error: 'Team slug already taken' }
    }

    const team = await prisma.team.create({
      data: {
        name: validated.name,
        slug: validated.slug,
        ownerId: user.id,
        members: {
          create: {
            userId: user.id,
            role: 'OWNER',
          },
        },
      },
    })

    revalidatePath('/teams')
    return { success: true, team }
  } catch (error) {
    console.error('Create team error:', error)
    return { error: 'Failed to create team' }
  }
}

export async function inviteTeamMember(teamId: string, formData: FormData) {
  try {
    const user = await requireAuth()
    await requirePermission(user.id, teamId, 'team:manage_members')

    const email = formData.get('email') as string
    const role = formData.get('role') as TeamRole

    const validated = inviteMemberSchema.parse({ email, role })

    // Find or create user
    let invitee = await prisma.user.findUnique({
      where: { email: validated.email },
    })

    if (!invitee) {
      // Create placeholder user (they'll set password on first login)
      invitee = await prisma.user.create({
        data: {
          email: validated.email,
          passwordHash: '', // Will be set on first login
        },
      })
    }

    // Check if already a member
    const existing = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: invitee.id,
        },
      },
    })

    if (existing) {
      return { error: 'User is already a team member' }
    }

    const member = await prisma.teamMember.create({
      data: {
        teamId,
        userId: invitee.id,
        role: validated.role,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
      },
    })

    revalidatePath(`/teams/${teamId}/members`)
    return { success: true, member }
  } catch (error) {
    console.error('Invite member error:', error)
    return { error: 'Failed to invite member' }
  }
}

export async function updateMemberRole(teamId: string, formData: FormData) {
  try {
    const user = await requireAuth()
    await requirePermission(user.id, teamId, 'team:manage_members')

    const memberId = formData.get('memberId') as string
    const role = formData.get('role') as TeamRole

    const validated = updateMemberRoleSchema.parse({ memberId, role })

    // Get current user's role
    const currentMembership = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: user.id } },
    })

    // Get target member's current role
    const targetMember = await prisma.teamMember.findUnique({
      where: { id: validated.memberId },
    })

    if (!targetMember) {
      return { error: 'Member not found' }
    }

    // Check if user can manage this role
    if (!canManageRole(currentMembership!.role, targetMember.role)) {
      return { error: 'You cannot modify this member\'s role' }
    }

    if (!canManageRole(currentMembership!.role, validated.role)) {
      return { error: 'You cannot assign this role' }
    }

    const updated = await prisma.teamMember.update({
      where: { id: validated.memberId },
      data: { role: validated.role },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
      },
    })

    revalidatePath(`/teams/${teamId}/members`)
    return { success: true, member: updated }
  } catch (error) {
    console.error('Update role error:', error)
    return { error: 'Failed to update role' }
  }
}

export async function removeTeamMember(teamId: string, memberId: string) {
  try {
    const user = await requireAuth()
    await requirePermission(user.id, teamId, 'team:manage_members')

    const currentMembership = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: user.id } },
    })

    const targetMember = await prisma.teamMember.findUnique({
      where: { id: memberId },
    })

    if (!targetMember) {
      return { error: 'Member not found' }
    }

    if (!canManageRole(currentMembership!.role, targetMember.role)) {
      return { error: 'You cannot remove this member' }
    }

    await prisma.teamMember.delete({
      where: { id: memberId },
    })

    revalidatePath(`/teams/${teamId}/members`)
    return { success: true }
  } catch (error) {
    console.error('Remove member error:', error)
    return { error: 'Failed to remove member' }
  }
}
