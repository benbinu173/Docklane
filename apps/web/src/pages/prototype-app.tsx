import { lazy, Suspense } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { WorkspaceShell } from '@/components/workspace-shell'
import { DetailPanels } from '@/components/detail-panels'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/hooks/use-workspace'
import { DemoProvider } from '@/lib/demo-context'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from 'sonner'
import { useTheme } from '@/lib/theme'
import '@/styles.css'
import '@/experience.css'

const Overview = lazy(() => import('@/pages/overview'))
const Inventory = lazy(() => import('@/pages/inventory'))
const Orders = lazy(() => import('@/pages/orders'))
const Warehouses = lazy(() =>
  import('@/pages/supporting').then((module) => ({ default: module.Warehouses })),
)
const Payments = lazy(() =>
  import('@/pages/supporting').then((module) => ({ default: module.Payments })),
)
const Activity = lazy(() =>
  import('@/pages/supporting').then((module) => ({ default: module.Activity })),
)
const Settings = lazy(() =>
  import('@/pages/supporting').then((module) => ({ default: module.Settings })),
)

function NotFound() {
  const { go } = useWorkspace()
  return (
    <div className="empty-state spacious">
      <h1>This lane leads elsewhere.</h1>
      <p>We couldn’t find that page. Your workspace is one click away.</p>
      <Button className="btn-primary" onClick={() => go('/')}>
        Return to overview
      </Button>
    </div>
  )
}
function Prototype() {
  const location = useLocation()
  const reduced = useReducedMotion()
  return (
    <WorkspaceShell>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          className="page-content"
          key={location.pathname}
          initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: reduced ? 1 : 0 }}
          transition={{ duration: reduced ? 0 : 0.16 }}
        >
          <Suspense
            fallback={
              <div className="route-loading" aria-busy="true" aria-label="Opening page">
                <div className="skeleton short" />
                <div className="skeleton-panel" />
              </div>
            }
          >
            <Routes location={location}>
              <Route path="/" element={<Overview />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/warehouses" element={<Warehouses />} />
              <Route path="/payments" element={<Payments />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </motion.div>
      </AnimatePresence>
      <DetailPanels />
    </WorkspaceShell>
  )
}

export default function PrototypeApp() {
  const { resolved } = useTheme()
  return (
    <TooltipProvider delayDuration={250}>
      <DemoProvider>
        <Prototype />
        <Toaster
          theme={resolved}
          position="bottom-right"
          richColors
          closeButton
          toastOptions={{ className: 'docklane-toast' }}
        />
      </DemoProvider>
    </TooltipProvider>
  )
}
