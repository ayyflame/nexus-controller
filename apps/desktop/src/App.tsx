import { useEffect, useState } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { Onboarding } from "./components/Onboarding";
import { Sidebar } from "./components/Sidebar";
import { loadPage, savePage } from "./lib/lastPage";
import { resolvePage, type PageId } from "./lib/navigation";
import { UpdateBanner } from "./components/UpdateBanner";
import { EngineProvider, useEngine } from "./hooks/useEngine";
import { Dashboard } from "./pages/Dashboard";
import { MacroStudio } from "./pages/MacroStudio";
import { Performance } from "./pages/Performance";
import { MappingPage } from "./pages/Mapping";
import { LightingPage, MotionPage, SticksPage, TouchpadPage, TriggersPage } from "./pages/Tuning";
import { VirtualControllerPage } from "./pages/VirtualController";
import { LiveViewer } from "./pages/LiveViewer";
import { Profiles } from "./pages/Profiles";
import { Settings } from "./pages/Settings";

function Page({ id, tab }: { id: PageId; tab?: string }) {
  switch (id) {
    case "dashboard": return <Dashboard />;
    case "virtual-controller": return <VirtualControllerPage />;
    case "profiles": return <Profiles />;
    case "mapping": return <MappingPage initialControl={tab} />;
    case "macro-studio": return <MacroStudio initialTab={tab} />;
    case "sticks": return <SticksPage />;
    case "triggers": return <TriggersPage />;
    case "motion": return <MotionPage />;
    case "touchpad": return <TouchpadPage />;
    case "lighting": return <LightingPage />;
    case "live-viewer": return <LiveViewer initialTab={tab} />;
    case "performance": return <Performance />;
    case "settings": return <Settings />;
  }
}

function ShellBanner() {
  const { connection } = useEngine();
  if (connection.kind === "unavailable") {
    return (
      <div className="shell-banner">
        UI preview only: the controller engine runs inside the NEXUS desktop app. No device data is shown here.
      </div>
    );
  }
  if (connection.kind === "error") {
    return <div className="shell-banner error">Could not reach the controller engine: {connection.message}</div>;
  }
  return null;
}

export function App() {
  const [page, setPage] = useState<PageId>(loadPage);
  const [tab, setTab] = useState<string | undefined>();
  const [nav, setNav] = useState(0);
  // Every request goes through resolvePage, so older links (the former
  // Controller page and its tabs) still open the right page.
  const navigate = (p: string, t?: string) => {
    const r = resolvePage(p, t);
    setPage(r.page); setTab(r.tab); setNav((n) => n + 1); savePage(r.page);
  };
  useEffect(() => {
    const onNav = (e: Event) => { const d = (e as CustomEvent<{ page: string; tab?: string }>).detail; navigate(d.page, d.tab); };
    window.addEventListener("nexus:navigate", onNav);
    return () => window.removeEventListener("nexus:navigate", onNav);
  }, []);
  return (
    <EngineProvider>
      <div className="app">
        <Sidebar page={page} onNavigate={(p) => navigate(p)} />
        <CommandPalette onNavigate={navigate} />
        <Onboarding onNavigate={(p) => navigate(p)} />
        <main className="content">
          <ShellBanner />
          <UpdateBanner />
          <Page key={`${page}-${nav}`} id={page} tab={tab} />
        </main>
      </div>
    </EngineProvider>
  );
}
