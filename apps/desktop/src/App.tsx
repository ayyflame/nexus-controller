import { useEffect, useState } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { Onboarding } from "./components/Onboarding";
import { Sidebar, type PageId } from "./components/Sidebar";
import { UpdateBanner } from "./components/UpdateBanner";
import { EngineProvider, useEngine } from "./hooks/useEngine";
import { Dashboard } from "./pages/Dashboard";
import { MacroStudio } from "./pages/MacroStudio";
import { Performance } from "./pages/Performance";
import { Controller } from "./pages/Controller";
import { LiveViewer } from "./pages/LiveViewer";
import { Profiles } from "./pages/Profiles";
import { Settings } from "./pages/Settings";

function Page({ id, tab }: { id: PageId; tab?: string }) {
  switch (id) {
    case "dashboard": return <Dashboard />;
    case "settings": return <Settings />;
    case "profiles": return <Profiles />;
    case "performance": return <Performance />;
    case "macro-studio": return <MacroStudio />;
    case "controller": return <Controller initialTab={tab} />;
    case "live-viewer": return <LiveViewer />;
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
  const [page, setPage] = useState<PageId>("dashboard");
  const [tab, setTab] = useState<string | undefined>();
  const [nav, setNav] = useState(0);
  const navigate = (p: string, t?: string) => { setPage(p as PageId); setTab(t); setNav((n) => n + 1); };
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
