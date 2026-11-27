import { useEngine, usePrimaryDevice } from "../hooks/useEngine";
import { parseMacroRoute } from "../lib/macroStudio";
import { MacroEditorPage } from "./MacroEditorPage";
import { MacroLibraryPage } from "./MacroLibrary";

/**
 * Macro Studio's two pages, chosen by the address: the Macro Library (the
 * default) and a macro's editor ("edit:<id>", or "draft" for a new macro not
 * saved yet). Mapping links use the same addresses ("edit:<id>",
 * "new:<button>"). Each page is its own history entry, so Back and Forward move
 * between them.
 */
export function MacroStudio({ initialTab }: { initialTab?: string }) {
  const { connection, status, profile } = useEngine();
  const device = usePrimaryDevice();
  const route = parseMacroRoute(initialTab);
  // Status arrives about 60 times a second: pass on only what the pages show,
  // so they re-render when it changes, not on every report.
  const live = {
    ready: connection.kind === "ready",
    profileId: profile?.id ?? null,
    blockedReason: status && !status.macros.gamesCanReceive ? status.macros.blockedReason : null,
  };
  if (route.view === "library") {
    return <MacroLibraryPage {...live} hasDevice={device !== null} playingKey={(device?.playingMacros ?? []).join("\n")}
      create={route.create ? { trigger: route.trigger } : null} />;
  }
  // The editor page reads its macro once; a quiet address change (draft → saved) keeps it open.
  return <MacroEditorPage {...live} target={route.view === "editor" ? route.id : null} />;
}
