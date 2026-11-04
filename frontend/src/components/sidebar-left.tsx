// Adapted from official base-nova/sidebar-15; see docs/architecture.md.
import { useQuery } from '@tanstack/react-query'
import { AudioLines, FolderOpen, Music2, Piano } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { BrandWordmark } from '@/components/brand-wordmark'
import { listProjects } from '@/lib/api'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '@/components/ui/sidebar'

export function SidebarLeft() {
  const {
    data: projects,
    isPending,
    error,
  } = useQuery({ queryKey: ['projects'], queryFn: listProjects })
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  return (
    <Sidebar className="border-r-0">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="hover:bg-transparent active:bg-transparent data-open:bg-transparent"
              render={<a href="/" />}
              onClick={() => setOpenMobile(false)}
            >
              <BrandWordmark />
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === '/'}
              render={<a href="/" />}
              onClick={() => setOpenMobile(false)}
            >
              <FolderOpen />
              <span>Projects</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Recent projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isPending && (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    Loading projects…
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {error && (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    Could not load projects
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {projects?.length === 0 && (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    No projects yet
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {projects?.toSorted((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 5).map((project) => (
                <SidebarMenuItem key={project.id}>
                  <SidebarMenuButton
                    isActive={pathname === `/studio/${project.id}`}
                    render={<a href={`/studio/${project.id}`} />}
                    onClick={() => setOpenMobile(false)}
                  >
                    <Music2 />
                    <span>{project.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Library</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {[
                { label: 'Audio', icon: AudioLines, path: '/library/audio' },
                { label: 'Instruments', icon: Piano, path: '/library/instruments' },
              ].map(({ label, icon: Icon, path }) => (
                <SidebarMenuItem key={label}>
                  <SidebarMenuButton
                    isActive={pathname === path}
                    render={<a href={path} />}
                    onClick={() => setOpenMobile(false)}
                  >
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
