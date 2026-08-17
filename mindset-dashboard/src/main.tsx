import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { Analytics } from '@vercel/analytics/react'
import { retenirProvenance } from './utils/provenance'

/*
  Avant le premier rendu, et non dans un composant.

  Le paramètre `?s=` est dans l'adresse à l'instant du clic et nulle part ensuite :
  un écran qui le lirait au montage arriverait déjà trop tard si quoi que ce soit
  navigue avant lui. Ici, rien ne s'est encore exécuté.
*/
retenirProvenance()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <Analytics />
    </ErrorBoundary>
  </StrictMode>,
)
