import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { authClient, ApiError, restoreAuthSession } from './auth-client'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Profile } from '@docklane/contracts'

const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000'
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, error) => count < 1 && (!(error instanceof ApiError) || error.status >= 500),
    },
  },
})
type Session = { token: string; user: { id: string; name: string; email: string } }
interface IdentityContextValue {
  configured: boolean
  session: Session | null
  loading: boolean
  sessionError: string | null
  refresh: () => Promise<boolean>
  signOut: () => Promise<void>
  api: <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>
}
const IdentityContext = createContext<IdentityContextValue | null>(null)
function IdentityState({ children }: { children: ReactNode }) {
  const cache = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(!!authClient)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const token = useRef<{ value: string; until: number } | null>(null)
  const sessionEpoch = useRef(0)
  const invalidateSession = useCallback(() => {
    sessionEpoch.current++
  }, [])
  const refresh = useCallback(async () => {
    if (!authClient) return false
    const epoch = ++sessionEpoch.current
    try {
      const next = await restoreAuthSession()
      if (epoch !== sessionEpoch.current) return false
      setSessionError(null)
      setSession(next)
      token.current = null
      await cache.invalidateQueries({ queryKey: ['identity'] })
      return !!next
    } catch (error) {
      if (epoch !== sessionEpoch.current) return false
      setSessionError(
        error instanceof Error ? error.message : 'Sign-in is temporarily unavailable. Try again.',
      )
      setSession(null)
      return false
    } finally {
      if (epoch === sessionEpoch.current) setLoading(false)
    }
  }, [cache])
  // Session restoration synchronizes with the external identity provider.
  // The rule does not distinguish the awaited SDK request from local state work.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    return invalidateSession
  }, [refresh, invalidateSession])
  const api = useCallback(
    async <T,>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> => {
      if (!authClient || !session) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue.')
      if (!token.current || token.current.until < Date.now()) {
        // The managed SDK's 0.8.2 declarations omit plugin endpoint methods.
        // Use its typed fetch client so Neon still handles session credentials.
        const result = await authClient.$fetch<{ token: string }>('/token', {
          method: 'GET',
          headers: { 'X-Force-Fetch': 'true' },
        })
        if (result.error || !result.data?.token)
          throw new ApiError(401, 'UNAUTHORIZED', 'Your session has ended. Sign in again.')
        token.current = { value: result.data.token, until: Date.now() + 14 * 60_000 }
      }
      let response: Response
      try {
        response = await fetch(`${apiUrl}/api/v1${path}`, {
          method: options.method ?? 'GET',
          headers: {
            Authorization: `Bearer ${token.current.value}`,
            'X-Docklane-Session': session.token,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}),
          signal: AbortSignal.timeout(15_000),
          cache: 'no-store',
        })
      } catch {
        throw new ApiError(
          503,
          'SERVICE_UNAVAILABLE',
          'Your workspace is temporarily unavailable. Try again shortly.',
        )
      }
      const body = await response.json()
      if (!response.ok)
        throw new ApiError(
          response.status,
          body.error?.code ?? 'REQUEST_FAILED',
          body.error?.message ?? 'Something went wrong. Try again.',
        )
      return body as T
    },
    [session],
  )
  async function signOut() {
    invalidateSession()
    if (authClient) {
      const result = await authClient.signOut()
      if (result.error) throw new Error(result.error.message ?? 'Unable to sign out. Try again.')
    }
    token.current = null
    setSession(null)
    cache.clear()
  }
  return (
    <IdentityContext.Provider
      value={{ configured: !!authClient, session, loading, sessionError, refresh, signOut, api }}
    >
      {children}
    </IdentityContext.Provider>
  )
}
export function IdentityProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <IdentityState>{children}</IdentityState>
    </QueryClientProvider>
  )
}
// Context and hooks share one module so the auth client has a single lifetime.
// eslint-disable-next-line react-refresh/only-export-components
export function useIdentity() {
  const context = useContext(IdentityContext)
  if (!context) throw new Error('IdentityProvider is required.')
  return context
}
// eslint-disable-next-line react-refresh/only-export-components
export function useProfile() {
  const { api, session, loading } = useIdentity()
  return useQuery({
    queryKey: ['identity', 'profile', session?.user.id],
    queryFn: () => api<{ data: Profile }>('/me'),
    enabled: !!session && !loading,
  })
}
