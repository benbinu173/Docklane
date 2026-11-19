import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import { IconContext } from '@phosphor-icons/react/dist/lib/context'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DemoProvider } from '@/lib/demo-context'
import App from './App'
import '@fontsource/geist/latin-400.css'
import '@fontsource/geist/latin-500.css'
import '@fontsource/geist/latin-600.css'
import '@fontsource/geist/latin-700.css'
import '@fontsource/geist-mono/latin-400.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <IconContext.Provider value={{ size: 20, weight: 'regular' }}>
          <TooltipProvider delayDuration={250}>
            <DemoProvider>
              <App />
              <Toaster
                position="bottom-right"
                richColors
                closeButton
                toastOptions={{ className: 'docklane-toast' }}
              />
            </DemoProvider>
          </TooltipProvider>
        </IconContext.Provider>
      </MotionConfig>
    </BrowserRouter>
  </StrictMode>,
)
