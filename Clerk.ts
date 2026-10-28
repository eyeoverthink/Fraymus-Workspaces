
// Clerk auth for Fastify - verifies token, optional for free tier
import { verifyToken } from '@clerk/backend'

export async function authenticateClerk(req: any) {
  const secret = process.env.CLERK_SECRET_KEY
  if (!secret) return { userId: null, authenticated: false, reason: 'No CLERK_SECRET_KEY - running open' }

  const authHeader = req.headers.authorization || req.headers['x-clerk-auth'] || ''
  const token = authHeader.replace('Bearer ', '') || req.cookies?.__session || ''

  if (!token) return { userId: null, authenticated: false, reason: 'No token' }

  try {
    const payload = await verifyToken(token, { secretKey: secret })
    return { userId: payload.sub, authenticated: true, payload }
  } catch (e: any) {
    console.warn('Clerk verify failed', e.message)
    return { userId: null, authenticated: false, reason: e.message }
  }
}

export function clerkPreHandler() {
  return async (req: any, reply: any) => {
    const auth = await authenticateClerk(req)
    req.clerkAuth = auth
    // Don't block - allow free runs, but attach userId if present
    // To enforce auth: if (!auth.authenticated) return reply.status(401).send({error:'Unauthorized'})
  }
}
