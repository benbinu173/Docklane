import { rateLimit, ipKeyGenerator } from 'express-rate-limit'
import type { Request, Response, NextFunction } from 'express'
import { DomainError } from '@docklane/domain'

export interface RequestLimits {
  windowMs?: number
  requests?: number
  authenticationFailures?: number
  mutations?: number
  payments?: number
  webhooks?: number
}
export function requestLimits(limits: RequestLimits = {}) {
  const windowMs = limits.windowMs ?? 60_000
  const failures = new Map<string, { count: number; until: number }>()
  const address = (request: Request) =>
    ipKeyGenerator(request.ip ?? request.socket.remoteAddress ?? 'unknown')
  const reject = (request: Request, response: Response) =>
    response.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Wait a moment, then retry the same operation.',
        requestId: request.requestId,
      },
    })
  const make = (limit: number, account = false) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      // Forwarded headers are deliberately ignored unless the server explicitly trusts its proxy.
      validate: { xForwardedForHeader: false },
      ...(account ? { keyGenerator: (request: Request) => request.profile!.id } : {}),
      handler: reject,
    })
  return {
    all: make(limits.requests ?? 200),
    authentication(request: Request, response: Response, next: NextFunction) {
      const key = address(request)
      const entry = failures.get(key)
      if (entry && entry.until <= Date.now()) failures.delete(key)
      else if (entry && entry.count >= (limits.authenticationFailures ?? 30)) {
        response.setHeader('Retry-After', Math.ceil((entry.until - Date.now()) / 1000))
        reject(request, response)
        return
      }
      next()
    },
    recordAuthenticationFailure(request: Request) {
      const key = address(request)
      const entry = failures.get(key)
      if (entry && entry.until > Date.now()) entry.count++
      else {
        // Keep failed-only accounting bounded without counting legitimate concurrent checkouts.
        if (failures.size >= 10_000) failures.delete(failures.keys().next().value!)
        failures.set(key, { count: 1, until: Date.now() + windowMs })
      }
    },
    mutations: make(limits.mutations ?? 40, true),
    payments: make(limits.payments ?? 12, true),
    webhooks: make(limits.webhooks ?? 300),
  }
}
export function requireJson(request: Request) {
  if (['POST', 'PATCH'].includes(request.method) && !request.is('application/json'))
    throw new DomainError('UNSUPPORTED_MEDIA_TYPE', 'Send JSON using application/json.', 415)
}
