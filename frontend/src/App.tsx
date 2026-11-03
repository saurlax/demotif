import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ProjectsPage } from '@/features/projects/projects-page'
const StudioPage = lazy(() =>
  import('@/features/studio/studio-page').then((m) => ({
    default: m.StudioPage,
  })),
)
const LibraryPage = lazy(() =>
  import('@/features/library/library-page').then((m) => ({ default: m.LibraryPage })),
)
export default function App() {
  return (
    <Suspense
      fallback={
        <div className="flex h-svh items-center justify-center text-sm text-muted-foreground">
          Opening workspace…
        </div>
      }
    >
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/library/audio" element={<LibraryPage kind="audio" />} />
        <Route path="/library/instruments" element={<LibraryPage kind="instruments" />} />
        <Route path="/studio/:projectId" element={<StudioPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
