import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import { IconContext } from '@phosphor-icons/react/dist/lib/context'
import App from './App'
import '@fontsource/geist/latin-400.css'
import '@fontsource/geist/latin-500.css'
import '@fontsource/geist/latin-600.css'
import '@fontsource/geist/latin-700.css'
import '@fontsource/geist-mono/latin-400.css'
import './styles.css'

const application = (
  <StrictMode>
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <IconContext.Provider value={{ size: 20, weight: 'regular' }}>
          <App />
        </IconContext.Provider>
      </MotionConfig>
    </BrowserRouter>
  </StrictMode>
)
const root = document.getElementById('root')!
if (root.hasChildNodes()) hydrateRoot(root, application)
else createRoot(root).render(application)
