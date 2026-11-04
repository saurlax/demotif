"use client";
import dynamic from "next/dynamic";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/sonner";
const Projects = dynamic(
  () => import("@/features/projects/projects-page").then((m) => m.ProjectsPage),
  { ssr: false },
);
const Studio = dynamic(
  () => import("@/features/studio/studio-page").then((m) => m.StudioPage),
  { ssr: false },
);
const Library = dynamic(
  () => import("@/features/library/library-page").then((m) => m.LibraryPage),
  { ssr: false },
);
export function Workspace({
  view,
}: {
  view: "projects" | "studio" | "audio" | "instruments";
}) {
  return (
    <Providers>
      {view === "projects" ? (
        <Projects />
      ) : view === "studio" ? (
        <Studio />
      ) : (
        <Library kind={view} />
      )}
      <Toaster position="bottom-center" />
    </Providers>
  );
}
