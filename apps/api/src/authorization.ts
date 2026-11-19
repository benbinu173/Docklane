import type { Request, Response, NextFunction } from 'express'
import { DomainError, permits } from '@docklane/domain'
export function signedIn(request: Request) {
  if (!request.profile) throw new DomainError('UNAUTHORIZED', 'Sign in to continue.', 401)
  return request.profile
}
export function requirePermission(permission: Parameters<typeof permits>[1]) {
  return (request: Request, _response: Response, next: NextFunction) => {
    try {
      if (!permits(signedIn(request).role, permission))
        throw new DomainError('FORBIDDEN', 'Your account does not have permission to do that.', 403)
      next()
    } catch (error) {
      next(error)
    }
  }
}
