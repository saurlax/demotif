// Source: https://ui.shadcn.com/r/styles/base-nova/sidebar-15.json
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PanelRight } from 'lucide-react'
import { hasDraftChanges } from '@/features/studio/save-status'
import { navigate, registerNavigationGuard } from '@/lib/navigation'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog'
import { ThemeToggle } from '@/components/theme-toggle'
import { BrandWordmark } from '@/components/brand-wordmark'
import { SidebarLeft } from '@/components/sidebar-left'
import { SidebarRight } from '@/components/sidebar-right'
import { Breadcrumb } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'

export function AppShell({
  children,
  breadcrumb,
  rightPanel,
  headerActions,
  hasUnsavedChanges,
  studio = false,
}: {
  children: ReactNode
  breadcrumb: ReactNode
  rightPanel?: ReactNode
  headerActions?: ReactNode
  hasUnsavedChanges?: () => boolean
  studio?: boolean
}) {
  const [leaveOpen, setLeaveOpen] = useState(false)
  const unsavedChanges = useRef(hasUnsavedChanges)
  useEffect(() => { unsavedChanges.current = hasUnsavedChanges }, [hasUnsavedChanges])
  const leaveDecision = useRef<((leave: boolean) => void) | null>(null)
  const decideLeave = (leave: boolean) => {
    leaveDecision.current?.(leave)
    leaveDecision.current = null
    setLeaveOpen(false)
  }
  const [wide, setWide] = useState(
    () => window.matchMedia('(min-width: 1024px)').matches,
  )
  const [rightOpen, setRightOpen] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => {
    if (!studio) return
    const isDirty = () => !!unsavedChanges.current?.() || hasDraftChanges(document)
    const confirmLeave = (event: BeforeUnloadEvent) => {
      if (!isDirty()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', confirmLeave)
    const unregister = registerNavigationGuard(async () => {
      if (isDirty()) {
        const leave = await new Promise<boolean>((resolve) => {
          leaveDecision.current?.(false)
          leaveDecision.current = resolve
          setLeaveOpen(true)
        })
        if (!leave) return false
      }
      // The user has already confirmed this departure; do not ask a second time.
      window.removeEventListener('beforeunload', confirmLeave)
      return true
    })
    return () => {
      unregister()
      leaveDecision.current?.(false)
      leaveDecision.current = null
      window.removeEventListener('beforeunload', confirmLeave)
    }
  }, [studio])
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const update = () => setWide(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const showProducer = studio && !!rightPanel
  return (
    <SidebarProvider className={`app-shell h-svh min-h-0 overflow-hidden ${studio ? 'studio-theme' : ''}`}>
      <AlertDialog open={leaveOpen} onOpenChange={(open) => { if (!open) decideLeave(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>Leave without saving your changes?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => decideLeave(false)}>Keep editing</Button>
            <Button onClick={() => decideLeave(true)}>Leave without saving</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {!studio && <SidebarLeft />}
      <SidebarInset className="min-w-0 overflow-hidden">
        <header className="app-header sticky top-0 flex min-h-14 shrink-0 items-center gap-2 border-b bg-background">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 px-3 py-2">
            {studio && (
              <>
                <a
                  href="/"
                  aria-label="Demotif home"
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                    event.preventDefault()
                    navigate('/')
                  }}
                  className="flex h-9 shrink-0 items-center gap-2 rounded-md px-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <BrandWordmark />
                </a>
                <Separator
                  orientation="vertical"
                  className="mx-2 data-[orientation=vertical]:h-4"
                />
              </>
            )}
            {!studio && (
              <>
                <SidebarTrigger />
                <Separator
                  orientation="vertical"
                  className="mr-2 data-[orientation=vertical]:h-4"
                />
              </>
            )}
            <Breadcrumb className="min-w-0 flex-1">{breadcrumb}</Breadcrumb>
            {headerActions}
            <ThemeToggle />
            {showProducer && <Button
              variant="ghost"
              size="icon"
              className="ml-auto shrink-0"
              aria-label="Toggle Producer"
              aria-expanded={wide ? rightOpen : mobileOpen}
              onClick={() =>
                wide ? setRightOpen(!rightOpen) : setMobileOpen(true)
              }
            >
              <PanelRight />
            </Button>}
          </div>
        </header>
        <div
          className={`flex min-h-0 flex-1 flex-col ${studio ? 'overflow-hidden' : 'app-page gap-6 overflow-auto p-5 sm:p-8 @container'}`}
        >
          {children}
        </div>
      </SidebarInset>
      {showProducer && (wide ? (
        <SidebarRight open={rightOpen}>{rightPanel}</SidebarRight>
      ) : (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent className="gap-0 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Producer</SheetTitle>
              <SheetDescription>
                AI assistance for the current project
              </SheetDescription>
            </SheetHeader>
            {rightPanel}
          </SheetContent>
        </Sheet>
      ))}
    </SidebarProvider>
  )
}
