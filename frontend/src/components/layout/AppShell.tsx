import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar, MobileDrawer } from "./Sidebar";
import { Topbar } from "./Topbar";
import { MobileNav } from "./MobileNav";

export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <div className="min-h-dvh bg-paper lg:pl-[248px]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lift"
      >
        Skip to content
      </a>
      <Sidebar />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <Topbar onMenu={() => setDrawerOpen(true)} />
      <main id="main-content" className="mx-auto max-w-[1440px] px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-7">
        <Outlet />
      </main>
      <MobileNav />
    </div>
  );
}
