import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// Order matters: tokens define the variables, base styles the element defaults, app.css the
// dashboard components, then the new surfaces — marketing.css for the landing and onboarding,
// dashboard.css for Home and Collection, tryon.css for the AR experience, asset-pipeline.css for
// the photograph-to-cut-out screen. All seven are hand-written —
// see design.md D1 for why there is no CSS framework.
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'
import './styles/marketing.css'
import './styles/dashboard.css'
import './styles/tryon.css'
import './styles/asset-pipeline.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('The #root element is missing from index.html.')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
