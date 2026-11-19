import { lazy, Suspense } from 'react'
import { useLocation } from 'react-router-dom'

const Prototype = lazy(() => import('@/pages/prototype-app'))
const IdentityApp = lazy(() => import('@/pages/identity-app'))
const Landing = lazy(() => import('@/pages/landing'))
export default function App() {
  const { pathname } = useLocation()
  const page =
    pathname === '/welcome' ? (
      <Landing />
    ) : /^\/(auth|workspace|account)(\/|$)/.test(pathname) ? (
      <IdentityApp />
    ) : (
      <Prototype />
    )
  return (
    <Suspense
      fallback={
        <main className="identity-loading" role="status">
          Opening Docklane…
        </main>
      }
    >
      {page}
    </Suspense>
  )
}
