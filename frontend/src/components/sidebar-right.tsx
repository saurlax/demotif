// Adapted from official base-nova/sidebar-15; calendar content becomes Producer.
import type { ReactNode } from 'react'
import { Sidebar, SidebarContent } from '@/components/ui/sidebar'

export function SidebarRight({ children, open }: { children: ReactNode; open: boolean }) {
  return <Sidebar collapsible="none" className={`sticky top-0 h-svh shrink-0 border-l ${open ? 'hidden lg:flex' : 'hidden'}`}><SidebarContent className="overflow-hidden">{children}</SidebarContent></Sidebar>
}
