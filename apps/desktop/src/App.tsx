import { useEffect, useState } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { Onboarding } from "./components/Onboarding";
import { Sidebar } from "./components/Sidebar";
import { loadPage, savePage } from "./lib/lastPage";
import { leaveMacroEditor } from "./lib/macroSaves";
import { hashToRoute, resolvePage, routeToHash, type PageId, type Route } from "./lib/navigation";
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

/** Where navigation is asked to go (`nexus:navigate` events and in-app links). */
interface NavRequest {
  page: string;
  tab?: string;
  /** Replace the current history entry instead of adding one (e.g. leaving an editor whose macro is gone). */
  replace?: boolean;
  /** Only correct the address (and tab) of the current page, without reopening it. */
  quiet?: boolean;
}

/** The page to open on start: the address (after a reload), else the page open when NEXUS last closed. */
function startRoute(): Route {
  return hashToRoute(window.location.hash) ?? { page: loadPage() };
}

export function App() {
  const [{ page, tab }, setRoute] = useState<Route>(startRoute);
  const [nav, setNav] = useState(0);
  // Every request goes through resolvePage, so older links (the former
  // Controller page and its tabs) still open the right page. Each one is a
  // history entry (with its own address), so history Back and Forward move
  // between pages.
  const navigate = (req: NavRequest) => {
    // Leaving the Macro Editor (no-op elsewhere): a change still waiting for its
    // autosave is saved now, and nothing it does afterwards navigates.
    if (!req.quiet) void leaveMacroEditor();
    const r = resolvePage(req.page, req.tab);
    const url = routeToHash(r);
    try {
      if (req.replace || req.quiet) window.history.replaceState(r, "", url);
      else if (url !== window.location.hash) window.history.pushState(r, "", url);
    } catch { /* history unavailable: navigation still works */ }
    setRoute(r);
    if (!req.quiet) setNav((n) => n + 1);
    savePage(r.page);
  };
  useEffect(() => {
    try { window.history.replaceState(startRoute(), "", routeToHash(startRoute())); } catch { /* no history */ }
    const onNav = (e: Event) => navigate((e as CustomEvent<NavRequest>).detail);
    const onPop = () => {
      void leaveMacroEditor();
      const r = hashToRoute(window.location.hash) ?? { page: "dashboard" as PageId };
      setRoute(r); setNav((n) => n + 1); savePage(r.page);
    };
    window.addEventListener("nexus:navigate", onNav);
    window.addEventListener("popstate", onPop);
    return () => { window.removeEventListener("nexus:navigate", onNav); window.removeEventListener("popstate", onPop); };
  }, []);
  return (
    <EngineProvider>
      <div className="app">
        <Sidebar page={page} onNavigate={(p) => navigate({ page: p })} />
        <CommandPalette onNavigate={(p, t) => navigate({ page: p, tab: t })} />
        <Onboarding onNavigate={(p) => navigate({ page: p })} />
        <main className="content">
          <ShellBanner />
          <UpdateBanner />
          <Page key={`${page}-${nav}`} id={page} tab={tab} />
        </main>
      </div>
    </EngineProvider>
  );
}
