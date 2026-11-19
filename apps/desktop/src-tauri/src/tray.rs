//! The notification-area (tray) icon and showing/hiding the main window.

use crate::AppState;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

pub const TOOLTIP: &str = "NEXUS Controller Engine";

/// What a tray menu entry does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrayAction {
    Open,
    StopMacros,
    Quit,
}

/// Menu entries, top to bottom (`None` = separator).
pub const MENU: [Option<(&str, &str, TrayAction)>; 4] = [
    Some(("open", "Open NEXUS", TrayAction::Open)),
    Some(("stop_macros", "Stop all macros", TrayAction::StopMacros)),
    None,
    Some(("quit", "Quit NEXUS", TrayAction::Quit)),
];

pub fn action_for(id: &str) -> Option<TrayAction> {
    MENU.iter()
        .flatten()
        .find(|(i, _, _)| *i == id)
        .map(|(_, _, a)| *a)
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = Vec::new();
    for entry in MENU {
        match entry {
            Some((id, label, _)) => items.push(Box::new(MenuItem::with_id(
                app,
                id,
                label,
                true,
                None::<&str>,
            )?)),
            None => items.push(Box::new(PredefinedMenuItem::separator(app)?)),
        }
    }
    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        items.iter().map(|b| b.as_ref()).collect();
    let menu = Menu::with_items(app, &refs)?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip(TOOLTIP)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match action_for(event.id().as_ref()) {
            Some(TrayAction::Open) => show_main(app),
            Some(TrayAction::StopMacros) => {
                if let Some(state) = app.try_state::<AppState>() {
                    state.engine.stop_all_macros();
                }
            }
            // Stops the engine on the way out (RunEvent::Exit), which
            // releases every button and removes the virtual controller.
            Some(TrayAction::Quit) => app.exit(0),
            None => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Brings the main window back (from the tray, minimised or behind others).
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    if let Some(state) = app.try_state::<AppState>() {
        state.bridge.set_visible(true);
    }
}

/// Hides the main window to the tray. NEXUS keeps running; the UI status
/// stream pauses until the window is shown again.
pub fn hide_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    if let Some(state) = app.try_state::<AppState>() {
        state.bridge.set_visible(false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_menu_entry_has_a_unique_id_and_an_action() {
        let ids: Vec<&str> = MENU.iter().flatten().map(|(i, _, _)| *i).collect();
        let mut unique = ids.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(ids.len(), unique.len());
        assert_eq!(action_for("open"), Some(TrayAction::Open));
        assert_eq!(action_for("stop_macros"), Some(TrayAction::StopMacros));
        assert_eq!(action_for("quit"), Some(TrayAction::Quit));
        assert_eq!(action_for("unknown"), None);
    }

    #[test]
    fn quit_is_last_and_set_apart() {
        assert_eq!(MENU.last().unwrap().unwrap().2, TrayAction::Quit);
        assert!(MENU[MENU.len() - 2].is_none(), "a separator before Quit");
    }
}
