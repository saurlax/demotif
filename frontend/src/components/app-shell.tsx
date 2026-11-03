// Source: https://ui.shadcn.com/r/styles/base-nova/sidebar-15.json
import { useEffect, useState, type ReactNode } from 'react'
import { PanelRight, Sparkles } from 'lucide-react'
import { SidebarLeft } from '@/components/sidebar-left'
import { SidebarRight } from '@/components/sidebar-right'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'

export function AppShell({ children, breadcrumb, rightPanel, studio = false }: { children: ReactNode; breadcrumb: ReactNode; rightPanel?: ReactNode; studio?: boolean }) {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  const [rightOpen, setRightOpen] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const update = () => setWide(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const panel = rightPanel ?? <div className="flex flex-col gap-2 p-4"><Sparkles className="size-5" /><h2 className="font-medium">Producer</h2><p className="text-sm text-muted-foreground">Open a project to work with your AI producer.</p></div>
  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      <SidebarLeft />
      <SidebarInset className="min-w-0 overflow-hidden">
        <header className="sticky top-0 flex h-14 shrink-0 items-center gap-2 bg-background">
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
            <SidebarTrigger />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <Breadcrumb className="min-w-0">{breadcrumb}</Breadcrumb>
            <Button variant="ghost" size="icon" className="ml-auto shrink-0" aria-label="Toggle Producer" aria-expanded={wide ? rightOpen : mobileOpen} onClick={() => wide ? setRightOpen(!rightOpen) : setMobileOpen(true)}><PanelRight /></Button>
          </div>
        </header>
        <div className={`flex min-h-0 flex-1 flex-col gap-4 p-4 ${studio ? 'overflow-hidden' : 'overflow-auto @container'}`}>{children}</div>
      </SidebarInset>
      {wide ? <SidebarRight open={rightOpen}>{panel}</SidebarRight> : <Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetContent className="gap-0 p-0"><SheetHeader className="sr-only"><SheetTitle>Producer</SheetTitle><SheetDescription>AI assistance for the current project</SheetDescription></SheetHeader>{panel}</SheetContent></Sheet>}
    </SidebarProvider>
  )
}
