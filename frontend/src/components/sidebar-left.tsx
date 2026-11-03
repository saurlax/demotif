// Adapted from official base-nova/sidebar-15; see docs/architecture.md.
import { useQuery } from '@tanstack/react-query'
import { AudioLines, FolderOpen, Music2, Piano, Sparkles } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { listProjects } from '@/lib/api'
import { Sidebar, SidebarContent, SidebarHeader, SidebarRail, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, useSidebar } from '@/components/ui/sidebar'

export function SidebarLeft() {
  const { data: projects, isPending, error } = useQuery({ queryKey: ['projects'], queryFn: listProjects })
  const { pathname } = useLocation()
  const { setOpenMobile } = useSidebar()
  return (
    <Sidebar className="border-r-0">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem><SidebarMenuButton size="lg" render={<Link to="/" />} onClick={() => setOpenMobile(false)}><AudioLines /><span>Demotif</span></SidebarMenuButton></SidebarMenuItem>
          <SidebarMenuItem><SidebarMenuButton isActive={pathname === '/'} render={<Link to="/" />} onClick={() => setOpenMobile(false)}><FolderOpen /><span>Projects</span></SidebarMenuButton></SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Your projects</SidebarGroupLabel>
          <SidebarGroupContent><SidebarMenu>
            {isPending && <SidebarMenuItem><SidebarMenuButton disabled>Loading projects…</SidebarMenuButton></SidebarMenuItem>}
            {error && <SidebarMenuItem><SidebarMenuButton disabled>Could not load projects</SidebarMenuButton></SidebarMenuItem>}
            {projects?.length === 0 && <SidebarMenuItem><SidebarMenuButton disabled>No projects yet</SidebarMenuButton></SidebarMenuItem>}
            {projects?.map(project => <SidebarMenuItem key={project.id}><SidebarMenuButton isActive={pathname === `/studio/${project.id}`} render={<Link to={`/studio/${project.id}`} />} onClick={() => setOpenMobile(false)}><Music2 /><span>{project.name}</span></SidebarMenuButton></SidebarMenuItem>)}
          </SidebarMenu></SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Library · coming soon</SidebarGroupLabel>
          <SidebarGroupContent><SidebarMenu>
            {[{ label: 'Audio', icon: AudioLines }, { label: 'Instruments', icon: Piano }, { label: 'Generations', icon: Sparkles }].map(({ label, icon: Icon }) => <SidebarMenuItem key={label}><SidebarMenuButton disabled><Icon /><span>{label}</span></SidebarMenuButton></SidebarMenuItem>)}
          </SidebarMenu></SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-auto"><SidebarGroupLabel>Local workspace</SidebarGroupLabel></SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
