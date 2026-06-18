# Course+ Desktop

A thin native shell (Tauri 2) around the **live** Course+ web app. Same codebase,
same Supabase backend — so desktop and web stay in lock-step (Notion-style) with
zero extra sync code. The native layer is small but load-bearing:

- **Menu-bar tray** presence (left-click opens the window; right-click → Open / Quit).
- **Close hides instead of quits.** Hitting ⌘W / the red traffic light *hides* the
  window and keeps the process (and its webview) alive. An in-progress meeting
  recording keeps running with no window on screen. Quit is explicit — tray → Quit.

## How sync works

There is no separate desktop build of the UI. The window simply loads
`https://nates123-cmd.github.io/Course-plus-app/` (see `windows[].url` in
`src-tauri/tauri.conf.json`). Every web deploy is instantly the desktop app too.
Data syncs because both point at the same per-user Supabase (`cp_*` tables).

To pin the desktop app to a local/dev build instead, change `windows[].url` to a
`http://localhost:5173` dev server (and run `npm run dev`).

## Multiple tabs

Tabs are a **web-app** feature (in-app tab bar, ⌘T / ⌘W / ⌘1–9, ⌘-click to open in
a new tab) — they work in the browser and the desktop shell alike. See `src/App.jsx`
(`TabBar`, the `tabState` model in `App`).

## Build & run

Requires the Rust toolchain (`cargo`) — already present for the Jot app.

```bash
# Dev: opens the shell pointed at the live URL with devtools
npm run desktop:dev

# Release: produces Course+.app + a .dmg under src-tauri/target/release/bundle/
npm run desktop:build
```

The first build downloads + compiles ~400 crates (several minutes); later builds
are incremental. Output:

- `src-tauri/target/release/bundle/macos/Course+.app`
- `src-tauri/target/release/bundle/dmg/Course+_0.1.0_*.dmg`

Builds are **ad-hoc signed** (unsigned for distribution). First launch: right-click →
Open to get past Gatekeeper, same as Jot.

## Microphone

Meeting recording needs mic access. The plumbing is in place:

- `src-tauri/Info.plist` → `NSMicrophoneUsageDescription` (the prompt text).
- `src-tauri/Entitlements.plist` → `com.apple.security.device.audio-input`.

macOS prompts for mic permission on the first recording. If a remote-loaded
webview ever refuses `getUserMedia` despite the entitlement, the fix is a WKWebView
media-permission handler on the Rust side — not needed unless it actually blocks.

> Tab/system-audio capture (`getDisplayMedia`) is a Chrome-desktop feature and is
> **not** expected to work inside WKWebView; the recorder falls back to mic-only.

## Files

```
src-tauri/
  Cargo.toml            crate + tauri deps (tray-icon, macos-private-api)
  build.rs              tauri-build
  tauri.conf.json       window → live URL, bundle targets, icons, entitlements
  Info.plist            mic usage string (merged into the .app)
  Entitlements.plist    audio-input + network client
  capabilities/         IPC capability for the main window
  shell/index.html      stub frontend (redirect fallback if the URL is down)
  src/
    main.rs             bin entry
    lib.rs              tray + hide-on-close
  icons/                generated from public/icon.svg
```

## What this is NOT (yet)

- Recording survives a window *close*, **not** a full Quit. True survive-quit would
  need a native Rust audio sidecar writing to disk independent of the webview —
  deferred to v2.
- No auto-update channel; reinstall the .dmg to update the shell (the *app content*
  updates itself from the live URL).
