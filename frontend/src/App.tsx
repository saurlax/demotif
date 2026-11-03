import { Navigate, Route, Routes } from 'react-router-dom'

import { ProjectsPage } from '@/features/projects/projects-page'
import { StudioPage } from '@/features/studio/studio-page'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ProjectsPage />} />
      <Route path="/studio/:projectId" element={<StudioPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
