// Source: https://ui.shadcn.com/r/styles/base-nova/sidebar-15.json
import { useEffect, useState, type ReactNode } from 'react'
import { useBlocker, useLocation } from 'react-router-dom'
import { PanelRight } from 'lucide-react'
import { hasDraftChanges } from '@/features/studio/save-status'
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
  const location = useLocation()
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    const blocked = studio && currentLocation.pathname !== nextLocation.pathname &&
      (!!hasUnsavedChanges?.() || hasDraftChanges(document))
    return blocked
  })
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    const destination = `${blocker.location.pathname}${blocker.location.search}${blocker.location.hash}`
    const origin = `${location.pathname}${location.search}${location.hash}`
    const leave = () => {
      if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== origin) return
      blocker.reset()
      window.location.assign(destination)
    }
    // POP blocking restores history asynchronously. Wait for that restoration so
    // cancelling the native prompt leaves both the URL and the draft intact.
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` === origin) leave()
    else window.addEventListener('popstate', leave)
    return () => window.removeEventListener('popstate', leave)
  }, [blocker, location])
  const [wide, setWide] = useState(
    () => window.matchMedia('(min-width: 1024px)').matches,
  )
  const [rightOpen, setRightOpen] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => {
    if (!studio) return
    const confirmLeave = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges?.() && !hasDraftChanges(document)) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', confirmLeave)
    return () => window.removeEventListener('beforeunload', confirmLeave)
  }, [studio, hasUnsavedChanges])
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const update = () => setWide(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const showProducer = studio && !!rightPanel
  return (
    <SidebarProvider className={`app-shell h-svh min-h-0 overflow-hidden ${studio ? 'studio-theme' : ''}`}>
      {!studio && <SidebarLeft />}
      <SidebarInset className="min-w-0 overflow-hidden">
        <header className="app-header sticky top-0 flex min-h-14 shrink-0 items-center gap-2 border-b bg-background">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 px-3 py-2">
            {studio && (
              <>
                <a
                  href="/"
                  aria-label="Demotif home"
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
