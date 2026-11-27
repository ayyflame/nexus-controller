# NEXUS UI design system

The desktop app's look comes from one set of tokens and shared components.
A page never invents its own colours, sizes or button styles.

## Files (`apps/desktop/src/styles/`)

`global.css` imports the layers in this order:

| File | Holds |
|---|---|
| `tokens.css` | Every colour, font size, space, radius, shadow and timing |
| `base.css` | Reset, type, helper classes, focus ring, scrollbars, reduced motion |
| `components.css` | Buttons, inputs, toggles, tabs, badges, cards, notices, tables, tooltips, dialogs, toasts, key caps |
| `shell.css` | Sidebar, top bar, page layout, banners, narrow-window rail |
| `features/*.css` | Only what is specific to one area: dashboard, macro, controller, profiles, settings, tools |

## Colour

- **Surfaces**, dark to light: `--bg-sidebar`, `--bg`, `--surface-inset` (wells inside cards), `--surface-1` (cards), `--surface-2` (controls), `--surface-3` (hover), `--surface-4` (pressed / selected neutral).
- **Accent, electric blue:** used for primary actions, the active state, selection and focus only.
  - `--accent` marks indicators and selected borders.
  - `--accent-bright` is accent text.
  - `--accent-strong` fills primary buttons, with white text.
- **Status:** `--ok`, `--warn` and `--error`, each with `-text`, `-wash` and `-line` variants. Status is never shown by colour alone: there is always a word or an icon too. Warning and error notices get an icon automatically.
- **Controller marks:** `--mark-*` tokens, shared by the 3D model, the Mapping legend and Live Viewer:
  - pressed = accent
  - remapped = cyan
  - macro = violet
  - disabled = red

## Type

- **Font:** Segoe UI Variable on Windows. Inter or the system font elsewhere.
- **Sizes:** `--fs-page` 24, `--fs-section` 16, `--fs-card` 14.5, `--fs-body` 13.5, `--fs-small` 12.5, `--fs-xs` 11.5.
- **Case:** labels use sentence case. Only sidebar and list group labels are upper case (`--fs-overline`).
- **Mono** (`.mono`, `--mono`) is only for numbers, timings and identifiers.

## Components

- **Buttons:** `btn-primary` (one per area), `btn-secondary`, `btn-ghost` (outline/tertiary), `btn-ghost danger` (destructive, quiet), `btn-danger` (confirming a destructive action), `btn-icon`.
  - Heights are 34 px; `.small` is 28 px.
  - `aria-busy="true"` shows a spinner.
- **Choices:** `segmented` (one of a few), `preset` (pill chips), `tabs` (underline), `switch` (on/off).
- **Containers:** `card`; `card panel` for stacked content; `well` for an inset area; `kv-row` for label/value rows; `notice` with `warn`, `error`, `ok` or `dev`; `empty-state`.
- **Status tiles:** `components/StatusTile.tsx` (`StatusStrip`, `StatusTile`): the state of one thing in words, with an icon in its tone. The Dashboard, Virtual Controller and Performance use them; four across, two below 1280 px.
- **Tabs:** `components/Tabs.tsx` for page-level tabs (Live Viewer): one Tab stop, arrow keys, Home and End, and a `tabpanel` labelled by its tab.
- **Status words:** `.tone-text-ok`, `-warn`, `-error`, `-idle` colour a status word; the word itself always says the state.
- **Unavailable values** say why ("Not measured yet", "Virtual controller off", "Not reported by this engine build"), never 0 or a bare dash.
- **Page errors:** each page renders inside `PageErrorBoundary`. A page that fails shows the error and *Try again*; the sidebar and other pages keep working.
- **Icons:** `components/Icons.tsx` only. One stroke style on a 24 px grid, used at 13–18 px. No emoji or typed symbols as icons.
- **Motion:** `--t-fast` (120 ms), `--t` (160 ms) and `--t-slow` (220 ms) with `--ease`.
  - Nothing bounces.
  - `prefers-reduced-motion` turns animation off.
  - Looping animations pause while another program is in front.

## Shell

- **Sidebar:** navigation only. Labels are always visible at supported window sizes (the window is at least 1100 px wide). Below 1040 px (for example in a browser) it becomes a 64 px icon rail; its labels stay readable to screen readers and show as native tooltips only then.
- **Top bar** (`components/TopBar.tsx`):
  - shows where you are (`pageTrail` in `lib/navigation.ts`);
  - holds the active-profile switcher;
  - shows controller and virtual-controller status, from the engine's live status only.
- **Pages:** a page is a `.page` (max 1360 px, 32 px side margin) with a `.page-header`.

## Accessibility rules

- **Text contrast:** `--text-faint` is the dimmest text colour. It is at least 4.5:1 against every surface, including the hover surface.
- **Control outlines:** inputs, selects and switches use `--border-control`, at least 3:1 against every surface. Decorative borders (`--border`, `--border-strong`) may be subtler.
- **Skip link:** a "Skip to content" button is the first Tab stop. It focuses the page area, `#main-content`.
- **Loading and status text:** loading states use `.skeleton` or `.spinner` inside `role="status"` with `aria-busy`. Text meant only for screen readers uses `.sr-only`.

## Windows: what still needs checking on a real PC

The window is set to a dark theme (`"theme": "Dark"` in `tauri.conf.json`), and its background (`#0e0f12`) matches `--bg`, so there is no flash while the page loads. None of the following has been checked on Windows:

1. **Title bar:** dark with Windows in both light and dark mode, on Windows 10 and Windows 11.
2. **Fonts:** Segoe UI Variable on Windows 11 and Segoe UI on Windows 10.
   - Check the Macro Library header, the top bar and Settings at the minimum window size (1100×700): no wrapping or clipping.
   - Check that 11–12 px text is readable at 100%, 125% and 150% display scaling.
3. **Native controls:** select dropdowns open dark, positioned under their field. The colour picker opens. Range sliders show their filled part.
4. **Scrollbars** look the same in the page, in lists and in the sidebar.
5. **Window resizing** between the minimum size and full screen: the sidebar keeps its labels (the icon rail only starts below 1040 px), and dialogs stay inside the window.
6. **Virtual Controller, Performance and Live Viewer** at 1100×700 and full screen, with a real controller:
   - Virtual Controller: the output options show *Active* only while Windows has the Xbox 360 controller (`joy.cpl`); *Check drivers again* reports ViGEmBus and HidHide as Windows sees them; the HidHide card never says the controller is hidden.
   - Performance: the numbers move while a game runs; unplugging the controller shows *Input stopped* and a finding; nothing reads 0 where it should say "not measured".
   - Live Viewer: the header names the plugged-in controller and says *Live input*; unplugging it switches to *Input stopped*; the tabs work with the arrow keys.
7. **Screen reader (Narrator or NVDA)** in the Macro Editor's controller list:
   - an action's buttons are announced as toggles;
   - the trigger is announced as current;
   - a repeated unavailable choice is announced each time;
   - curve points can be removed with Delete.
8. **Screen reader on the Phase 2 pages:**
   - Virtual Controller: each output option is read as a radio button with its state (for example "Xbox 360, Active") and its description or the reason it can't be chosen.
   - Live Viewer: a change of input state is announced once (for example "Input stopped"), not on every update; the Live Viewer tabs are read as tabs.
   - Performance: the timing tables are read with their column headers.
