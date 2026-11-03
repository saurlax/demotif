import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'

import App from './App.tsx'
import { Providers } from './app/providers'
import './index.css'

const router = (import.meta.hot?.data.router as ReturnType<typeof createBrowserRouter> | undefined)
  ?? createBrowserRouter([{ path: '*', element: <App /> }])
if (import.meta.hot) import.meta.hot.data.router = router
const root = (import.meta.hot?.data.root as Root | undefined) ?? createRoot(document.getElementById('root')!)
if (import.meta.hot) import.meta.hot.data.root = root
root.render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
      <Toaster position="bottom-center" />
    </Providers>
  </StrictMode>,
)
