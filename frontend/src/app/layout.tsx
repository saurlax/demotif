import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import "@/index.css";
export const metadata: Metadata = {
  title: "Demotif",
  description: "Demotif music workspace",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="" />
        <Script id="demotif-theme" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem("theme")||"dark";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"}catch{}})()` }} />
      </head>
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
