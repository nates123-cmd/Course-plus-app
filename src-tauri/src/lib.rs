// Course+ desktop shell. The webview loads the live web app (so desktop and
// web stay in lock-step, Notion-style), and shared Supabase keeps the data in
// sync. The native job here is small but load-bearing: a menu-bar tray, and
// closing the window HIDES it instead of quitting — the webview keeps running,
// so an in-progress meeting recording survives even with no window on screen.
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewWindow, WindowEvent,
};

const WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "course-plus-tray";

fn show_window(win: &WebviewWindow) {
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
}

#[tauri::command]
fn focus_window(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window(WINDOW_LABEL) {
        show_window(&win);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![focus_window])
        // Intercept the window close: keep the process (and any live recording)
        // alive by hiding the window instead of destroying it. Quit is explicit,
        // via the tray menu.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            // Tray: left-click shows/focuses the window; right-click menu has
            // Show + Quit.
            let show = MenuItem::with_id(app, "show", "Open Course+", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Course+", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let _tray = TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Course+")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window(WINDOW_LABEL) {
                            show_window(&win);
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(win) = tray.app_handle().get_webview_window(WINDOW_LABEL) {
                            show_window(&win);
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Course+ desktop");
}
