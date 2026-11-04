import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Disc3, Loader2, Plus, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { navigate } from '@/lib/navigation'

import { ExamplePicker } from './example-picker'
import { AppShell } from '@/components/app-shell'
import {
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError, createProject, listProjects } from '@/lib/api'

function formatUpdated(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function ProjectsPage() {
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [tempo, setTempo] = useState(120)
  const {
    data: projects,
    isPending,
    error,
  } = useQuery({ queryKey: ['projects'], queryFn: listProjects })

  const create = useMutation({
    mutationFn: () => createProject({ name: name.trim() || 'Untitled', tempo }),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      navigate(`/studio/${project.id}`)
    },
  })

  async function importFile(file: File | undefined) {
    if (!file) return
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error('Project JSON must be under 10 MB')
      const r = await fetch('/api/projects/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: await file.text(),
      })
      const body = await r.json()
      if (!r.ok)
        throw new Error(
          body.message ?? body.detail?.[0]?.msg ?? 'Invalid project',
        )
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      navigate(`/studio/${body.id}`)
    } catch (e) {
      setImportError(String(e))
    }
  }
  const breadcrumb = (
    <BreadcrumbList>
      <BreadcrumbItem>
        <BreadcrumbPage>Projects</BreadcrumbPage>
      </BreadcrumbItem>
    </BreadcrumbList>
  )

  return (
    <AppShell breadcrumb={breadcrumb}>
      <div className="projects-toolbar flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={createOpen} onOpenChange={(open) => {
            setCreateOpen(open)
            if (open) create.reset()
          }}>
            <DialogTrigger render={<Button />}>
              <Plus />
              New project
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create project</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  create.mutate()
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="project-name" className="text-sm">
                    Name
                  </Label>
                  <Input
                    id="project-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Untitled"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="project-tempo" className="text-sm">
                    Tempo (BPM)
                  </Label>
                  <Input
                    id="project-tempo"
                    className="text-base md:text-base"
                    type="number"
                    min={20}
                    step={0.1}
                    max={300}
                    value={tempo}
                    onChange={(event) => setTempo(Number(event.target.value))}
                  />
                </div>
                {create.error && (
                  <p role="alert" className="text-sm text-destructive">
                    {create.error instanceof ApiError
                      ? create.error.message
                      : 'Could not create the project.'}
                  </p>
                )}
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={create.isPending}
                  >
                    {create.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Plus />
                    )}
                    Create project
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Button variant="outline" onClick={() => fileInput.current?.click()}>
            <Upload />
            Import project
          </Button>
          <ExamplePicker />
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => void importFile(e.target.files?.[0])}
      />
      {importError && (
        <p role="alert" className="text-sm text-destructive">{importError}</p>
      )}
      <section aria-label="Your projects" className="min-w-0 space-y-4">
        {isPending && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive">
            {error instanceof ApiError
              ? error.message
              : 'Could not load projects.'}
          </p>
        )}
        {projects?.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No projects yet. Create one to open the studio.
            </CardContent>
          </Card>
        )}
        <div className="grid gap-4 @xl:grid-cols-2">
          {projects?.map((project) => (
            <Card key={project.id} className="project-card gap-0 py-0">
              <button
                type="button"
                onClick={() => navigate(`/studio/${project.id}`)}
                className="group flex w-full items-center gap-4 p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="project-symbol" aria-hidden="true"><Disc3 className="size-6" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-medium" title={project.name}>{project.name}</div>
                  <p className="mt-1 text-xs text-muted-foreground">Updated {formatUpdated(project.updated_at)}</p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
              </button>
            </Card>
          ))}
        </div>
      </section>
    </AppShell>
  )
}
