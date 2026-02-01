'use server'

import { prisma } from '@/lib/prisma'
import {
  hashPassword,
  verifyPassword,
  createSession,
  setSessionCookie,
  logout,
  getCurrentUser,
} from '@/lib/auth'
import { loginSchema, signupSchema } from '@/lib/validators'
import { revalidatePath } from 'next/cache'

export async function login(formData: FormData) {
  try {
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    const validated = loginSchema.parse({ email, password })

    const user = await prisma.user.findUnique({
      where: { email: validated.email },
    })

    if (!user) {
      return { error: 'Invalid email or password' }
    }

    const isValid = await verifyPassword(validated.password, user.passwordHash)
    if (!isValid) {
      return { error: 'Invalid email or password' }
    }

    const token = await createSession(user.id)
    await setSessionCookie(token)

    revalidatePath('/')
    return { success: true, user: { id: user.id, email: user.email, name: user.name } }
  } catch (error) {
    console.error('Login error:', error)
    return { error: 'An error occurred during login' }
  }
}

export async function signup(formData: FormData) {
  try {
    const name = formData.get('name') as string
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    const validated = signupSchema.parse({ name, email, password })

    const existingUser = await prisma.user.findUnique({
      where: { email: validated.email },
    })

    if (existingUser) {
      return { error: 'Email already registered' }
    }

    const passwordHash = await hashPassword(validated.password)

    const user = await prisma.user.create({
      data: {
        email: validated.email,
        name: validated.name,
        passwordHash,
      },
    })

    // Create default team for new user
    const teamSlug = `${validated.name?.toLowerCase().replace(/\s+/g, '-') || user.id.slice(0, 8)}-team`
    await prisma.team.create({
      data: {
        name: `${validated.name || 'My'}'s Team`,
        slug: teamSlug,
        ownerId: user.id,
        members: {
          create: {
            userId: user.id,
            role: 'OWNER',
          },
        },
      },
    })

    const token = await createSession(user.id)
    await setSessionCookie(token)

    revalidatePath('/')
    return { success: true, user: { id: user.id, email: user.email, name: user.name } }
  } catch (error) {
    console.error('Signup error:', error)
    return { error: 'An error occurred during signup' }
  }
}

export async function signOut() {
  await logout()
  revalidatePath('/')
  return { success: true }
}

export async function getUser() {
  return getCurrentUser()
}
