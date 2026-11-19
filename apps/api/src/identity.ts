import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { DomainError } from '@docklane/domain'
import type { createAuthSessionStore } from '@docklane/database'

export interface Identity {
  subject: string
  name: string
  email: string
}
export type IdentityVerifier = (jwt: string, sessionToken: string) => Promise<Identity>
export function createIdentityVerifier(
  authStore: ReturnType<typeof createAuthSessionStore>,
  issuer: string,
  keys: JWTVerifyGetKey,
): IdentityVerifier {
  return async (jwt, sessionToken) => {
    let subject: string
    try {
      const { payload } = await jwtVerify(jwt, keys, {
        issuer,
        algorithms: ['EdDSA'],
        maxTokenAge: '15m',
        clockTolerance: 5,
      })
      if (!payload.sub || !payload.exp || payload.exp - (payload.iat ?? 0) > 905)
        throw new Error('Invalid token claims')
      subject = payload.sub
    } catch {
      throw new DomainError('UNAUTHORIZED', 'Sign in again to continue.', 401)
    }
    let session
    try {
      session = await authStore.verify(sessionToken, subject)
    } catch {
      throw new DomainError(
        'IDENTITY_UNAVAILABLE',
        'Sign-in services are temporarily unavailable. Try again shortly.',
        503,
      )
    }
    if (!session)
      throw new DomainError(
        'UNAUTHORIZED',
        'Your session has ended. Sign in again to continue.',
        401,
      )
    return { subject, name: session.name, email: session.email }
  }
}
export function remoteIdentityVerifier(
  authStore: ReturnType<typeof createAuthSessionStore>,
  authUrl: string,
  jwksUrl: string,
) {
  return createIdentityVerifier(
    authStore,
    new URL(authUrl).origin,
    createRemoteJWKSet(new URL(jwksUrl), { timeoutDuration: 8_000, cooldownDuration: 10_000 }),
  )
}
