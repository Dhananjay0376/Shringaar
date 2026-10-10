import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// Order matters: tokens define the variables, base styles the element defaults, app.css the
// components. All three are hand-written — see design.md D1 for why there is no CSS framework.
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('The #root element is missing from index.html.')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
