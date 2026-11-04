"use client";
import dynamic from "next/dynamic";
const ClientWorkspace = dynamic(
  () => import("./workspace-content").then((m) => m.Workspace),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-svh items-center justify-center text-sm text-muted-foreground">
        Opening workspace…
      </div>
    ),
  },
);
export function Workspace({
  view,
}: {
  view: "projects" | "studio" | "audio" | "instruments";
}) {
  return <ClientWorkspace view={view} />;
}
