import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ChevronDown, Download, FolderOpen, Loader2, Save, SaveAll } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuShortcut } from '@/components/ui/dropdown-menu'
import { listProjects } from '@/lib/api'
import type { Project } from '@/types/project'

export function ProjectMenu({ project, saving, busy, exporting, onSave, onSaveAs, onExport,
  saveAsOpen, onSaveAsOpenChange }: {
  project: Project
  saving: boolean
  busy: boolean
  exporting: boolean
  onSave: () => void
  onSaveAs: (name: string) => Promise<void>
  onExport: () => void
  saveAsOpen: boolean
  onSaveAsOpenChange: (open: boolean) => void
}) {
  const [openProject, setOpenProject] = useState(false)
  const [search, setSearch] = useState('')
  const [saveName, setSaveName] = useState(project.name)
  const [error, setError] = useState('')
  const example = !!project.draft_example_id || !project.draft_base_id
  const projects = useQuery({ queryKey: ['projects'], queryFn: listProjects, enabled: openProject })
  useEffect(() => {
    if (saveAsOpen) {
      setSaveName(project.name)
      setError('')
      setOpenProject(false)
    }
  }, [saveAsOpen, project.name])
  const matches = projects.data?.filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()))
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className="min-w-0 max-w-full justify-start px-2 text-foreground" />}
        aria-label={`Project menu: ${project.name}`}>
        <span className="truncate">{project.name}</span><ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64 max-w-[calc(100vw-2rem)]" align="start">
        <DropdownMenuItem className="min-h-8" disabled={saving}
          onClick={() => { setSearch(''); setOpenProject(true) }}><FolderOpen />Open project…</DropdownMenuItem>
        <DropdownMenuSeparator />
        {!example && <DropdownMenuItem className="min-h-8" disabled={saving} onClick={onSave}>
          <Save />Save<DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
        </DropdownMenuItem>}
        <DropdownMenuItem className="min-h-8" disabled={busy || saving} onClick={() => onSaveAsOpenChange(true)}>
          <SaveAll />Save as…<DropdownMenuShortcut>⇧⌘S</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-8" disabled={exporting} onClick={onExport}>
          {exporting ? <Loader2 className="animate-spin" /> : <Download />}{exporting ? 'Rendering…' : 'Export audio…'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={saveAsOpen} onOpenChange={(value) => { if (!saving) onSaveAsOpenChange(value) }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Save project as</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault()
          if (!saveName.trim() || saving) return
          setSaveName(saveName.trim())
          void onSaveAs(saveName.trim()).then(() => onSaveAsOpenChange(false)).catch((error) => setError(String(error.message ?? error)))
        }}>
          <div className="space-y-1.5"><Label htmlFor="save-project-name">Name</Label>
            <Input id="save-project-name" data-saved-value={project.name} value={saveName}
              onChange={(event) => setSaveName(event.target.value)} maxLength={200} disabled={saving} autoFocus /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => onSaveAsOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || !saveName.trim()}>{saving ? <Loader2 className="animate-spin" /> : <Save />}Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={openProject} onOpenChange={setOpenProject}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Open project</DialogTitle></DialogHeader>
        <Input aria-label="Search projects" placeholder="Search projects" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="max-h-[55svh] overflow-y-auto">
          {projects.isPending && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading…</p>}
          {projects.error && <div role="alert" className="text-sm text-destructive">Could not load projects.
            <Button variant="ghost" onClick={() => void projects.refetch()}>Retry</Button></div>}
          {matches?.map((item) => <a key={item.id} href={`/studio/${item.id}`}
            className="flex min-h-12 items-center gap-3 border-b px-2 py-3 text-sm last:border-0 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
            <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 wrap-break-word">{item.name}</span><ArrowRight className="size-4 shrink-0 text-muted-foreground" />
          </a>)}
          {matches?.length === 0 && <p className="py-3 text-sm text-muted-foreground">{search ? 'No matching projects.' : 'No saved projects.'}</p>}
        </div>
      </DialogContent>
    </Dialog>
  </>
}
