import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Loader2, Music4, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { AppShell } from '@/components/app-shell'
import { Badge } from '@/components/ui/badge'
import {
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError, createProject, listProjects } from '@/lib/api'

function formatUpdated(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function ProjectsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [tempo, setTempo] = useState(120)
  const { data: projects, isPending, error } = useQuery({ queryKey: ['projects'], queryFn: listProjects })

  const create = useMutation({
    mutationFn: () => createProject({ name: name.trim() || 'Untitled', tempo }),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      navigate(`/studio/${project.id}`)
    },
  })

  const breadcrumb = (
    <BreadcrumbList>
      <BreadcrumbItem className="hidden md:block">
        <BreadcrumbLink href="/">Demotif</BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbSeparator className="hidden md:block" />
      <BreadcrumbItem>
        <BreadcrumbPage>Projects</BreadcrumbPage>
      </BreadcrumbItem>
    </BreadcrumbList>
  )

  return (
    <AppShell breadcrumb={breadcrumb}>
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Music4 className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Projects</h1>
          <p className="text-xs text-muted-foreground">
            Compose through conversation, humming, and precise editing.
          </p>
        </div>
        <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">
          local workspace
        </Badge>
      </div>

      <div className="grid gap-6 @3xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-sm">Start a project</CardTitle>
            <CardDescription className="text-xs">
              Set a name and tempo. You can change both later through the producer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                create.mutate()
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="project-name" className="text-xs">
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
                <Label htmlFor="project-tempo" className="text-xs">
                  Tempo (BPM)
                </Label>
                <Input
                  id="project-tempo"
                  type="number"
                  min={30}
                  max={300}
                  value={tempo}
                  onChange={(event) => setTempo(Number(event.target.value))}

                />
              </div>
              <Button type="submit" size="sm" className="w-full" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                Create project
              </Button>
              {create.error && (
                <p className="text-[11px] text-destructive">
                  {create.error instanceof ApiError ? create.error.message : 'Could not create the project.'}
                </p>
              )}
            </form>
          </CardContent>
        </Card>

        <section className="min-w-0 space-y-3">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Your projects</h2>
          {isPending && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </p>
          )}
          {error && (
            <p className="text-sm text-destructive">
              {error instanceof ApiError ? error.message : 'Could not load projects.'}
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
              <Card key={project.id} className="gap-0 py-0">
                <button
                  type="button"
                  onClick={() => navigate(`/studio/${project.id}`)}
                  className="group w-full p-4 text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate text-sm font-medium">{project.name}</span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Updated {formatUpdated(project.updated_at)}
                  </p>
                </button>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  )
}
