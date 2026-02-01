import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from './prisma'
import bcrypt from 'bcryptjs'
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000 // 7 days

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function generateSessionToken(): string {
  // Use Web Crypto API for edge compatibility
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function createSession(userId: string): Promise<string> {
  const token = generateSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_DURATION)

  await prisma.session.create({
    data: {
      token,
      userId,
      expiresAt,
    },
  })

  return token
}

export async function validateSession(token: string) {
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  })

  if (!session) return null
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } })
    return null
  }

  return session.user
}

export async function getCurrentUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get(process.env.AUTH_COOKIE_NAME || 'observability_session')?.value
  
  if (!token) return null
  return validateSession(token)
}

export async function requireAuth() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies()
  cookieStore.set(process.env.AUTH_COOKIE_NAME || 'observability_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DURATION / 1000,
    path: '/',
  })
}

export async function clearSessionCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(process.env.AUTH_COOKIE_NAME || 'observability_session')
}

export async function logout() {
  const cookieStore = await cookies()
  const token = cookieStore.get(process.env.AUTH_COOKIE_NAME || 'observability_session')?.value
  
  if (token) {
    await prisma.session.deleteMany({ where: { token } })
  }
  
  clearSessionCookie()
}
