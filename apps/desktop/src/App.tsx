import { useState } from "react";
import { Sidebar, type PageId } from "./components/Sidebar";
import { EngineProvider, useEngine } from "./hooks/useEngine";
import { Dashboard } from "./pages/Dashboard";
import { MacroStudio } from "./pages/MacroStudio";
import { Performance } from "./pages/Performance";
import { Controller } from "./pages/Controller";
import { Profiles } from "./pages/Profiles";
import { Settings } from "./pages/Settings";

function Page({ id }: { id: PageId }) {
  switch (id) {
    case "dashboard": return <Dashboard />;
    case "settings": return <Settings />;
    case "profiles": return <Profiles />;
    case "performance": return <Performance />;
    case "macro-studio": return <MacroStudio />;
    case "controller": return <Controller />;
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
  return (
    <EngineProvider>
      <div className="app">
        <Sidebar page={page} onNavigate={setPage} />
        <main className="content">
          <ShellBanner />
          <Page id={page} />
        </main>
      </div>
    </EngineProvider>
  );
}
