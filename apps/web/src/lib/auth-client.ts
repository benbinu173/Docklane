import { createAuthClient } from '@neon/auth'
import { BetterAuthReactAdapter } from '@neon/auth/react/adapters'
import { z } from 'zod'
const authUrl = import.meta.env.VITE_NEON_AUTH_URL as string | undefined
let providerSessionToken: string | null = null
const providerSession = z.object({ session: z.object({ token: z.string().min(1) }) })
export const authClient = authUrl
  ? createAuthClient(authUrl, {
      adapter: BetterAuthReactAdapter({
        fetchOptions: {
          credentials: 'include',
          cache: 'no-store',
          onResponse: async (context) => {
            if (new URL(context.request.url).pathname.endsWith('/get-session')) {
              // Neon replaces session.token with its JWT in the SDK response. Preserve
              // the opaque provider token separately for immediate API revocation checks.
              const raw = providerSession.safeParse(await context.response.clone().json())
              providerSessionToken = raw.success ? raw.data.session.token : null
            }
          },
        },
      }),
    })
  : null
export async function restoreAuthSession() {
  if (!authClient) return null
  const result = await authClient.getSession({
    query: { disableCookieCache: true },
    fetchOptions: { headers: { 'X-Force-Fetch': 'true' } },
  })
  if (result.error) throw new Error(result.error.message ?? 'Unable to restore your session.')
  if (!result.data?.user || !result.data.session || !providerSessionToken) return null
  return {
    token: providerSessionToken,
    user: { id: result.data.user.id, name: result.data.user.name, email: result.data.user.email },
  }
}
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}
