// Nota: local listener on 127.0.0.1:4317 that the extension POSTs notes to.
// Notes are stored as raw JSON (schema owned by the frontend) in notes.json.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
mod hover;
mod images;
mod mcp;

use serde_json::Value;
use std::{collections::{HashMap, HashSet}, fs, io::Read, path::PathBuf, process::Stdio, sync::Mutex};
use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State, Wry};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;

// Debug builds (`bun dev`) are a separate app, Nota Dev: own data folder, port and assistant entry,
// and no global shortcuts, so they can run next to the installed Nota and never touch it.
pub const DEV: bool = cfg!(debug_assertions);
pub const IDENTIFIER: &str = if DEV { "app.nota.desktop.dev" } else { "app.nota.desktop" };
const ADDR: &str = if DEV { "127.0.0.1:4318" } else { "127.0.0.1:4317" };
// The extension only knows 4317: NOTA_ADDR=127.0.0.1:4317 bun dev, with Nota quit, to test it against the dev app.
pub fn addr() -> String {
    std::env::var("NOTA_ADDR").ok().filter(|_| DEV).unwrap_or(ADDR.into())
}
const MAC: bool = cfg!(target_os = "macos");
const BROWSER_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

struct Store {
    path: PathBuf,
    notes: Mutex<Vec<Value>>,
    folders_path: PathBuf,
    folders: Mutex<Vec<String>>,
    settings_path: PathBuf,
    settings: Mutex<serde_json::Map<String, Value>>, // sound, hoverKey, theme, keepImages (see settings.tsx)
    removed_path: PathBuf,
    removed: Mutex<HashSet<String>>, // ids the user removed, so imports don't bring them back
}

// write to tmp + rename so a crash mid-write never corrupts the file
fn write_json(path: &PathBuf, value: &impl serde::Serialize) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec(value)?)?;
    fs::rename(tmp, path)
}

fn read_json<T: serde::de::DeserializeOwned + Default>(path: &PathBuf) -> T {
    fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

impl Store {
    fn load(dir: PathBuf) -> Self {
        let path = dir.join("notes.json");
        let folders_path = dir.join("folders.json");
        let settings_path = dir.join("settings.json");
        let removed_path = dir.join("removed.json");
        Store {
            removed: Mutex::new(read_json(&removed_path)),
            removed_path,
            settings: Mutex::new(read_json(&settings_path)),
            settings_path,
            notes: Mutex::new(read_json(&path)),
            folders: Mutex::new(read_json(&folders_path)),
            path,
            folders_path,
        }
    }

    fn save(&self, notes: &[Value]) -> std::io::Result<()> {
        write_json(&self.path, &notes)
    }

    // Batched, so removing a big selection writes notes.json once.
    fn remove(&self, ids: Vec<String>) -> std::io::Result<()> {
        let mut notes = self.notes.lock().unwrap();
        let gone: HashSet<&str> = ids.iter().map(String::as_str).collect();
        notes.retain(|n| !n["id"].as_str().is_some_and(|id| gone.contains(id)));
        self.save(&notes)?;
        let mut removed = self.removed.lock().unwrap();
        removed.extend(ids);
        write_json(&self.removed_path, &*removed)
    }

    // Merge fields into notes; null removes the field. Ids that are gone are skipped.
    fn update(&self, updates: Vec<(String, serde_json::Map<String, Value>)>) -> std::io::Result<()> {
        let mut updates: HashMap<_, _> = updates.into_iter().collect();
        let mut notes = self.notes.lock().unwrap();
        for note in notes.iter_mut() {
            let Some(patch) = note["id"].as_str().and_then(|id| updates.remove(id)) else { continue };
            let Value::Object(note) = note else { continue };
            for (k, v) in patch {
                if v.is_null() {
                    note.remove(&k);
                } else {
                    note.insert(k, v);
                }
            }
        }
        self.save(&notes)
    }

    // What assistants can change (mcp.rs). Add-only on purpose: a saved post can mislead an assistant,
    // so at worst it mislabels saves. Ids that are gone are skipped.
    fn organize(&self, ids: Vec<String>, tags: Vec<String>, folder: Option<String>) -> std::io::Result<()> {
        if let Some(name) = &folder {
            let mut folders = self.folders.lock().unwrap();
            if !folders.contains(name) {
                folders.push(name.clone());
                write_json(&self.folders_path, &*folders)?;
            }
        }
        let ids: HashSet<String> = ids.into_iter().collect();
        let mut notes = self.notes.lock().unwrap();
        for note in notes.iter_mut().filter(|n| n["id"].as_str().is_some_and(|id| ids.contains(id))) {
            if !tags.is_empty() {
                let old = tags_of(note);
                note["tags"] = tags.clone().into();
                merge_tags(note, old);
            }
            if let Some(name) = &folder {
                note["folder"] = name.clone().into();
            }
        }
        self.save(&notes)
    }

    // Returns whether any note changed, so a re-import of known posts writes nothing.
    fn upsert(&self, incoming: Vec<Value>) -> std::io::Result<bool> {
        let mut notes = self.notes.lock().unwrap();
        let mut removed = self.removed.lock().unwrap();
        let (mut changed, mut revived) = (false, false);
        let mut index: HashMap<String, usize> = notes
            .iter()
            .enumerate()
            .filter_map(|(i, n)| Some((n.get("id")?.as_str()?.to_string(), i)))
            .collect();
        for mut n in incoming {
            let Some(id) = n.get("id").and_then(Value::as_str).map(str::to_string) else { continue };
            if n.get("url").and_then(Value::as_str).is_none() {
                continue;
            }
            // Bulk imports set `imported` and can't bring back a removed post.
            // Anything else (a new like, undo, a drop) is deliberate and restores it.
            let imported = n.as_object_mut().is_some_and(|o| o.remove("imported").is_some());
            if imported && removed.contains(&id) {
                continue;
            }
            revived |= removed.remove(&id);
            match index.get(&id).copied() {
                // Re-like / re-import refreshes content without losing richer live
                // data, app-side fields like `folder`, or the original savedAt.
                Some(i) => {
                    let old = notes[i].take();
                    let old_tags = tags_of(&old);
                    let mut merged = merge_note(old.clone(), n);
                    merge_tags(&mut merged, old_tags);
                    changed |= merged != old;
                    notes[i] = merged;
                }
                None => {
                    index.insert(id, notes.len());
                    notes.push(n);
                    changed = true;
                }
            }
        }
        if revived {
            write_json(&self.removed_path, &*removed)?;
        }
        if changed {
            self.save(&notes)?;
        }
        Ok(changed)
    }
}

// Prefer the richer value. Imports (X archive, Reddit JSON) often carry shorter
// or empty fields; they must not erase what a live site parser already saved.
fn merge_note(old: Value, new: Value) -> Value {
    match (new, old) {
        (Value::Object(mut new), Value::Object(old)) => {
            for (key, value) in old {
                match key.as_str() {
                    "savedAt" => {
                        new.insert(key, value);
                    }
                    // tags are unioned afterwards
                    "tags" => {
                        new.entry(key).or_insert(value);
                    }
                    "images" | "links" => {
                        let incoming_empty = new
                            .get(&key)
                            .and_then(Value::as_array)
                            .map_or(true, |list| list.is_empty());
                        if incoming_empty {
                            new.insert(key, value);
                        }
                    }
                    "text" | "title" | "author" => {
                        let keep_old = match (new.get(&key).and_then(Value::as_str), value.as_str()) {
                            (Some(incoming), Some(previous)) => {
                                previous.chars().count() > incoming.chars().count()
                            }
                            (None, Some(_)) => true,
                            _ => false,
                        };
                        if keep_old {
                            new.insert(key, value);
                        }
                    }
                    _ => {
                        new.entry(key).or_insert(value);
                    }
                }
            }
            Value::Object(new)
        }
        (new, _) => new,
    }
}

fn tags_of(note: &Value) -> Vec<String> {
    note
        .get("tags")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|tag| !tag.is_empty())
        .map(str::to_string)
        .collect()
}

fn merge_tags(note: &mut Value, mut tags: Vec<String>) {
    for tag in tags_of(note) {
        if !tags.contains(&tag) {
            tags.push(tag);
        }
    }
    if !tags.is_empty() {
        note["tags"] = Value::Array(tags.into_iter().map(Value::String).collect());
    }
}

#[tauri::command(async)] // off the main thread: scales with note count
fn list_notes(store: State<Store>) -> Vec<Value> {
    store.notes.lock().unwrap().clone()
}

// Bulk import from X's like.js archive. Upsert merges tags/folder into existing notes.
#[tauri::command(async)] // off the main thread: scales with note count
fn import_notes(app: AppHandle, store: State<Store>, notes: Vec<Value>) -> Result<usize, String> {
    let count = notes.len();
    enrich(&app, &notes);
    images::queue_notes(&app, &notes);
    if store.upsert(notes).map_err(|e| e.to_string())? {
        let _ = app.emit("notes-changed", ());
    }
    Ok(count)
}

#[tauri::command(async)] // off the main thread: scales with note count
fn update_notes(store: State<Store>, updates: Vec<(String, serde_json::Map<String, Value>)>) -> Result<(), String> {
    store.update(updates).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_folders(store: State<Store>) -> Vec<String> {
    store.folders.lock().unwrap().clone()
}

#[tauri::command]
fn set_folders(store: State<Store>, folders: Vec<String>) -> Result<(), String> {
    let mut f = store.folders.lock().unwrap();
    *f = folders;
    write_json(&store.folders_path, &*f).map_err(|e| e.to_string())
}

// Rename (to = Some) or delete (to = None) a folder, moving its notes along.
#[tauri::command(async)] // off the main thread: scales with note count
fn rename_folder(store: State<Store>, from: String, to: Option<String>) -> Result<(), String> {
    let mut folders = store.folders.lock().unwrap();
    match &to {
        Some(t) => folders.iter_mut().filter(|f| **f == from).for_each(|f| *f = t.clone()),
        None => folders.retain(|f| *f != from),
    }
    write_json(&store.folders_path, &*folders).map_err(|e| e.to_string())?;
    let mut notes = store.notes.lock().unwrap();
    for n in notes.iter_mut().filter(|n| n["folder"] == from.as_str()) {
        match &to {
            Some(t) => n["folder"] = Value::from(t.as_str()),
            None => {
                n.as_object_mut().map(|o| o.remove("folder"));
            }
        }
    }
    store.save(&notes).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(store: State<Store>) -> serde_json::Map<String, Value> {
    store.settings.lock().unwrap().clone()
}

#[tauri::command]
fn set_settings(app: AppHandle, store: State<Store>, patch: serde_json::Map<String, Value>) -> Result<(), String> {
    let mut s = store.settings.lock().unwrap();
    s.extend(patch);
    write_json(&store.settings_path, &*s).map_err(|e| e.to_string())?;
    drop(s);
    apply_theme(&app);
    Ok(())
}

pub(crate) fn setting(app: &AppHandle, key: &str) -> Value {
    app.state::<Store>().settings.lock().unwrap().get(key).cloned().unwrap_or(Value::Null)
}

// The webview follows the window's appearance, so CSS prefers-color-scheme just works.
fn apply_theme(app: &AppHandle) {
    let theme = match setting(app, "theme").as_str() {
        Some("light") => Some(tauri::Theme::Light),
        Some("dark") => Some(tauri::Theme::Dark),
        _ => None,
    };
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_theme(theme);
    }
}

#[tauri::command]
fn reveal_notes(app: AppHandle) {
    let store = app.state::<Store>();
    // notes.json doesn't exist until the first save, and revealing a missing file fails.
    if !store.path.exists() {
        let notes = store.notes.lock().unwrap();
        let _ = store.save(&notes);
    }
    let _ = app.opener().reveal_item_in_dir(&store.path);
}

#[tauri::command(async)] // off the main thread: scales with note count
fn delete_notes(store: State<Store>, ids: Vec<String>) -> Result<(), String> {
    store.remove(ids).map_err(|e| e.to_string())
}

fn listen(app: AppHandle) {
    let addr = addr();
    let server = match tiny_http::Server::http(&addr) {
        Ok(s) => s,
        Err(e) => return eprintln!("nota: can't listen on {addr}: {e}"),
    };
    for mut req in server.incoming_requests() {
        // X-Nota forces a CORS preflight, so random web pages can't post here
        let ok_header = req.headers().iter().any(|h| h.field.equiv("X-Nota"));
        let status = match (req.method(), req.url(), ok_header) {
            // Only the extension sends X-Nota, so this also tells the app it's installed.
            (tiny_http::Method::Get, "/ping", true) => {
                let _ = app.emit("extension-seen", ());
                200
            }
            (tiny_http::Method::Get, "/ping", _) => 200,
            (tiny_http::Method::Post, "/notes", true) => {
                let mut body = Vec::new();
                let _ = req.as_reader().take(10 << 20).read_to_end(&mut body);
                match serde_json::from_slice::<Value>(&body) {
                    Ok(Value::Array(v)) => save(&app, v),
                    Ok(v @ Value::Object(_)) => save(&app, vec![v]),
                    _ => 400,
                }
            }
            (tiny_http::Method::Post, "/organize", true) => {
                let mut body = Vec::new();
                let _ = req.as_reader().take(1 << 20).read_to_end(&mut body);
                match serde_json::from_slice::<Value>(&body) {
                    Ok(body @ Value::Object(_)) => organize(&app, body),
                    _ => 400,
                }
            }
            _ => 404,
        };
        let _ = req.respond(tiny_http::Response::empty(status));
    }
}

fn organize(app: &AppHandle, body: Value) -> u16 {
    let strings = |key: &str| -> Vec<String> {
        body[key].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect()
    };
    let folder = body["folder"].as_str().map(str::to_string);
    match app.state::<Store>().organize(strings("ids"), strings("tags"), folder) {
        Ok(()) => {
            let _ = app.emit("notes-changed", ());
            200
        }
        Err(e) => {
            eprintln!("nota: organize failed: {e}");
            500
        }
    }
}

fn save(app: &AppHandle, notes: Vec<Value>) -> u16 {
    enrich(app, &notes);
    images::queue_notes(app, &notes);
    match app.state::<Store>().upsert(notes) {
        Ok(changed) => {
            if changed {
                let _ = app.emit("notes-changed", ());
            }
            200
        }
        Err(e) => {
            eprintln!("nota: save failed: {e}");
            500
        }
    }
}

// Links saved bare (hover, clipboard, drop, right-click → Save link) get the page's
// Open Graph title / description / image in the background, like a Discord embed.
// Only fills empty fields, so it never overwrites what a site parser saved.
fn enrich(app: &AppHandle, notes: &[Value]) {
    if notes.len() > 5 {
        return; // ponytail: bulk imports bring their own content; don't fetch thousands of pages
    }
    for n in notes {
        let blank = |k: &str| n[k].as_str().map_or(true, str::is_empty) && n[k].as_array().map_or(true, Vec::is_empty);
        let (Some(id), Some(url)) = (n["id"].as_str(), n["url"].as_str()) else { continue };
        if n["source"] != "web" || !url.starts_with("http") || !blank("text") || !blank("images") {
            continue;
        }
        let (app, id, url) = (app.clone(), id.to_string(), url.to_string());
        std::thread::spawn(move || {
            let Some((title, text, image)) = fetch_og(&url) else { return };
            let store = app.state::<Store>();
            let mut notes = store.notes.lock().unwrap();
            let Some(Value::Object(note)) = notes.iter_mut().find(|n| n["id"] == id.as_str()) else { return };
            let cur = note.get("title").and_then(Value::as_str).unwrap_or("");
            if let Some(t) = title.filter(|_| cur.is_empty() || cur.starts_with("http")) {
                note.insert("title".into(), t.into());
            }
            if let Some(t) = text.filter(|_| note.get("text").and_then(Value::as_str).map_or(true, str::is_empty)) {
                note.insert("text".into(), t.into());
            }
            if let Some(i) = image.filter(|_| note.get("images").and_then(Value::as_array).map_or(true, Vec::is_empty)) {
                note.insert("images".into(), serde_json::json!([i]));
                if i.starts_with("http") {
                    images::queue_url(&app, i);
                }
            }
            let _ = store.save(&notes);
            drop(notes);
            let _ = app.emit("notes-changed", ());
        });
    }
}

// (title, description, image). ponytail: system curl + a string scan of <head>
// instead of an HTTP client and HTML parser; enough for meta tags.
fn fetch_og(url: &str) -> Option<(Option<String>, Option<String>, Option<String>)> {
    let mut curl = std::process::Command::new("curl");
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut curl, 0x0800_0000); // CREATE_NO_WINDOW: no console flash
    let mut curl = curl
        .args(["-sL", "--max-time", "8", "--compressed", "-H", "Accept-Language: en"])
        .args(["-A", BROWSER_UA])
        .arg(url)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    // Meta tags live at the top: stop at 1 MB so a saved link to a huge file can't fill memory.
    let mut body = Vec::new();
    let _ = curl.stdout.take()?.take(1 << 20).read_to_end(&mut body);
    let _ = curl.kill();
    let _ = curl.wait();
    let html = String::from_utf8_lossy(&body);
    let head = &html[..html.find("</head>").or_else(|| html.find("<body")).unwrap_or(html.len())];
    let mut meta = std::collections::HashMap::new();
    for tag in head.split("<meta").skip(1) {
        let tag = &tag[..tag.find('>').unwrap_or(tag.len())];
        if let (Some(k), Some(v)) = (attr(tag, "property").or_else(|| attr(tag, "name")), attr(tag, "content")) {
            meta.entry(k.to_ascii_lowercase()).or_insert(v);
        }
    }
    let pick = |keys: &[&str]| keys.iter().find_map(|k| meta.get(*k).filter(|v| !v.trim().is_empty()).map(|v| v.trim().to_string()));
    let title = pick(&["og:title", "twitter:title"]).or_else(|| {
        let t = &head[head.find("<title")?..];
        let t = &t[t.find('>')? + 1..];
        Some(decode(t[..t.find("</title")?].trim())).filter(|t| !t.is_empty())
    });
    let text = pick(&["og:description", "twitter:description", "description"]);
    let image = pick(&["og:image", "og:image:url", "twitter:image", "twitter:image:src"]).map(|i| {
        let origin = url.splitn(4, '/').take(3).collect::<Vec<_>>().join("/");
        match i {
            i if i.starts_with("//") => format!("https:{i}"),
            i if i.starts_with('/') => format!("{origin}{i}"),
            i => i,
        }
    });
    (title.is_some() || text.is_some() || image.is_some()).then_some((title, text, image))
}

// Value of `name="…"` / `name='…'` in a tag, HTML entities decoded.
fn attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let at = lower.match_indices(&format!("{name}=")).find(|(i, _)| *i == 0 || lower.as_bytes()[i - 1].is_ascii_whitespace())?.0;
    let rest = &tag[at + name.len() + 1..];
    let q = rest.chars().next().filter(|c| *c == '"' || *c == '\'')?;
    let rest = &rest[1..];
    Some(decode(&rest[..rest.find(q)?]))
}

fn decode(s: &str) -> String {
    s.replace("&quot;", "\"").replace("&#39;", "'").replace("&#x27;", "'").replace("&apos;", "'")
        .replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ").replace("&amp;", "&")
}

#[cfg(test)]
mod og_test {
    #[test]
    fn parses_meta_tags() {
        let tag = r#" property="og:title" content="MesoWatch &amp; Co" "#;
        assert_eq!(super::attr(tag, "property").as_deref(), Some("og:title"));
        assert_eq!(super::attr(tag, "content").as_deref(), Some("MesoWatch & Co"));
        assert_eq!(super::attr(" data-name='x' name='description' content='hi'", "name").as_deref(), Some("description"));
    }
}

// macOS only: Windows has no menu bar, and its menus reject the Cmd key used below.
// app.tsx handles the same shortcuts there.
fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, label: &str, key: &str| MenuItemBuilder::with_id(id, label).accelerator(key).build(app);
    let nota = SubmenuBuilder::new(app, &app.package_info().name)
        .about(Some(AboutMetadata::default()))
        .separator()
        .item(&item("settings", "Settings…", "CmdOrCtrl+,")?)
        .separator()
        .item(&item("reveal", "Show Notes in Finder", "CmdOrCtrl+Shift+O")?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    // Edit is required on macOS or copy/paste won't work in the search field.
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&item("search", "Search", "CmdOrCtrl+F")?)
        .item(&item("sidebar", "Toggle Sidebar", "Ctrl+Cmd+S")?)
        .separator()
        .item(&item("filter:all", "All", "CmdOrCtrl+1")?)
        .item(&item("filter:x", "X", "CmdOrCtrl+2")?)
        .item(&item("filter:reddit", "Reddit", "CmdOrCtrl+3")?)
        .item(&item("filter:youtube", "YouTube", "CmdOrCtrl+4")?)
        .item(&item("filter:github", "GitHub", "CmdOrCtrl+5")?)
        .item(&item("filter:hn", "Hacker News", "CmdOrCtrl+6")?)
        .item(&item("filter:bluesky", "Bluesky", "CmdOrCtrl+7")?)
        .item(&item("filter:instagram", "Instagram", "CmdOrCtrl+8")?)
        .item(&item("filter:web", "Web", "CmdOrCtrl+9")?)
        .separator()
        .item(&item("bigger", "Bigger Cards", "CmdOrCtrl+=")?)
        .item(&item("smaller", "Smaller Cards", "CmdOrCtrl+-")?)
        .separator()
        .fullscreen()
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;
    MenuBuilder::new(app).item(&nota).item(&edit).item(&view).item(&window).build()
}

fn show_window(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        let _ = app.show();
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn show_search(app: &AppHandle) {
    show_window(app);
    let _ = app.emit("menu", "search");
}

// Closing keeps Nota running in the menu bar, with no window or Dock icon, so the listener stays up.
#[cfg(target_os = "macos")]
fn hide_to_menu_bar(w: tauri::Window) {
    // Hiding a fullscreen window leaves a black Space behind, so leave fullscreen first.
    // ponytail: fixed wait for the macOS animation; AppKit's didExitFullScreen would need objc code.
    let fullscreen = w.is_fullscreen().unwrap_or(false);
    if fullscreen {
        let _ = w.set_fullscreen(false);
    }
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(if fullscreen { 800 } else { 0 }));
        let app = w.app_handle();
        let _ = w.hide();
        let _ = app.hide(); // hands focus back to the previous app
        // After hide: the other way round, the Dock icon stays.
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    });
}

#[cfg(target_os = "macos")]
fn tray(app: &AppHandle) -> tauri::Result<()> {
    // The accelerators only label the global shortcuts, which do the work (global_shortcuts).
    let item = |id: &str, label: &str, key: &str| MenuItemBuilder::with_id(id, label).accelerator(key).build(app);
    let menu = MenuBuilder::new(app)
        .item(&item("tray:open", &format!("Open {}", app.package_info().name), "Alt+Shift+Space")?)
        .item(&item("tray:clip", "Save Clipboard Link", "Alt+Cmd+S")?)
        .separator()
        .quit()
        .build()?;
    tauri::tray::TrayIconBuilder::new()
        .icon(tauri::include_image!("icons/tray.png"))
        .icon_as_template(true)
        .tooltip(&app.package_info().name)
        .menu(&menu)
        .build(app)?;
    Ok(())
}

// Alt+Shift+Space (Alt+Space is Raycast's): bring Nota forward and focus search.
// Alt+Cmd+S (Alt+Shift+C off macOS): save the clipboard link. Double-tap Shift: save the hovered link (hover.rs, macOS only).
fn global_shortcuts(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    hover::watch(app.clone());
    let show = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::Space);
    let clip = if MAC {
        Shortcut::new(Some(Modifiers::ALT | Modifiers::SUPER), Code::KeyS)
    } else {
        Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyC)
    };
    let handler = app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, sc, ev| {
                if ev.state() != ShortcutState::Pressed {
                    return;
                }
                if *sc == show {
                    show_search(app);
                } else if *sc == clip {
                    save_clipboard_link(app);
                }
            })
            .build(),
    );
    if let Err(e) = handler {
        return eprintln!("nota: global shortcut plugin failed: {e}");
    }
    for sc in [show, clip] {
        if let Err(e) = app.global_shortcut().register(sc) {
            eprintln!("nota: can't register global shortcut {sc}: {e}");
        }
    }
}

fn save_clipboard_link(app: &AppHandle) {
    let text = app.clipboard().read_text().unwrap_or_default();
    let url = text.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) || url.contains(char::is_whitespace) {
        let _ = app.emit("toast", "Clipboard has no link");
        return;
    }
    let msg = if save_link(app, url, url, &["clipboard"]) { "Saved link to Nota" } else { "Couldn't save link" };
    let _ = app.emit("toast", msg);
}

// Same id as the extension's link/page saves (`web:<url>`), so they dedupe.
fn save_link(app: &AppHandle, url: &str, title: &str, tags: &[&str]) -> bool {
    let host = url.split('/').nth(2).unwrap_or("").trim_start_matches("www.");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64);
    let note = serde_json::json!({
        "id": format!("web:{url}"), "source": "web", "url": url, "author": host,
        "title": title, "text": "", "images": [], "links": [], "tags": tags, "savedAt": now,
    });
    save(app, vec![note]) == 200
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|a| a == "--mcp") {
        return mcp::run(args.get(2).map(String::as_str));
    }
    // Release builds on Windows have no console, so a crash would otherwise leave no trace.
    std::panic::set_hook(Box::new(|info| {
        eprintln!("{info}");
        let _ = fs::write(std::env::temp_dir().join("nota-crash.log"), info.to_string());
    }));
    let mut context = tauri::generate_context!();
    if DEV {
        let config = context.config_mut();
        config.identifier = IDENTIFIER.into();
        config.product_name = Some("Nota Dev".into());
        for window in &mut config.app.windows {
            window.title = "Nota Dev".into();
        }
        context.package_info_mut().name = "Nota Dev".into(); // names the autostart entry too
    }
    let builder = tauri::Builder::default();
    let builder = if MAC { builder.menu(menu) } else { builder };
    #[cfg(target_os = "macos")]
    let builder = builder.on_window_event(|w, e| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = e {
            api.prevent_close();
            hide_to_menu_bar(w.clone());
        }
    });
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // card.tsx loads images through here first; off the main thread so a grid of files can't stall the UI
        .register_asynchronous_uri_scheme_protocol("notaimg", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || responder.respond(images::serve(&app, request.uri().path())));
        })
        .on_menu_event(|app, e| match e.id().as_ref() {
            "reveal" => reveal_notes(app.clone()),
            "tray:open" => show_window(app),
            "tray:clip" => save_clipboard_link(app),
            // search / filter:* are handled by the frontend
            id => {
                let _ = app.emit("menu", id);
            }
        })
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            app.manage(Store::load(dir.clone()));
            images::start(app.handle(), dir.join("images"));
            apply_theme(app.handle());
            if !DEV {
                global_shortcuts(app.handle()); // ponytail: the installed Nota owns these; remove the check to test them, with it quit
            }
            #[cfg(target_os = "macos")]
            tray(app.handle())?;
            let handle = app.handle().clone();
            std::thread::spawn(move || listen(handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_notes,
            delete_notes,
            update_notes,
            import_notes,
            list_folders,
            set_folders,
            rename_folder,
            get_settings,
            set_settings,
            reveal_notes,
            images::images_size,
            images::clear_images,
            mcp::assistants,
            mcp::connect_assistant,
            mcp::disconnect_assistant
        ])
        .build(context)
        .expect("error while running nota")
        .run(|_app, _e| {
            // Launching Nota again (Finder, Spotlight) while it's hidden in the menu bar.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _e {
                show_window(_app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn organize_only_adds_tags_and_registers_new_folders() {
        let dir = std::env::temp_dir().join(format!(
            "nota-organize-test-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let store = Store::load(dir.clone());
        store
            .upsert(vec![
                json!({"id": "1", "url": "https://x.com", "tags": ["x-bookmarks", "rust"], "folder": "Old"}),
                json!({"id": "2", "url": "https://x.com"}),
                json!({"id": "3", "url": "https://x.com", "tags": ["keep"]}),
            ])
            .unwrap();

        let ids = vec!["1".to_string(), "2".to_string(), "gone".to_string()];
        store.organize(ids.clone(), vec!["rust".into(), "async".into()], Some("Reading".into())).unwrap();
        store.organize(ids, vec![], Some("Reading".into())).unwrap();

        let reloaded = Store::load(dir.clone());
        let notes = reloaded.notes.lock().unwrap();
        assert_eq!(notes[0]["tags"], json!(["x-bookmarks", "rust", "async"]), "keeps old tags, no duplicates");
        assert_eq!(notes[0]["folder"], "Reading");
        assert_eq!(notes[1]["tags"], json!(["rust", "async"]));
        assert_eq!(notes[2], json!({"id": "3", "url": "https://x.com", "tags": ["keep"]}), "other notes untouched");
        assert_eq!(*reloaded.folders.lock().unwrap(), ["Reading"], "registered once, so the sidebar shows it");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn bulk_update_and_remove_touch_only_the_given_notes() {
        let dir = std::env::temp_dir().join(format!(
            "nota-bulk-test-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let store = Store::load(dir.clone());
        let note = |id: &str| json!({"id": id, "url": "https://x.com", "folder": "Old", "tags": ["a"]});
        store.upsert(vec![note("1"), note("2"), note("3")]).unwrap();

        let patch = |v: Value| v.as_object().unwrap().clone();
        store
            .update(vec![
                ("1".into(), patch(json!({"folder": "New"}))),
                ("2".into(), patch(json!({"folder": null, "tags": ["a", "b"]}))),
                ("gone".into(), patch(json!({"folder": "New"}))),
            ])
            .unwrap();
        {
            let notes = store.notes.lock().unwrap();
            assert_eq!(notes[0]["folder"], "New");
            assert!(notes[1].get("folder").is_none());
            assert_eq!(notes[1]["tags"], json!(["a", "b"]));
            assert_eq!(notes[2], note("3"));
            assert_eq!(notes.len(), 3);
        }

        store.remove(vec!["1".into(), "3".into()]).unwrap();
        let reloaded = Store::load(dir.clone()); // both reached disk, and imports stay blocked
        assert_eq!(reloaded.notes.lock().unwrap().len(), 1);
        assert_eq!(reloaded.notes.lock().unwrap()[0]["id"], "2");
        assert!(reloaded.removed.lock().unwrap().contains("1") && reloaded.removed.lock().unwrap().contains("3"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn upsert_merges_without_losing_richer_or_app_fields() {
        let dir = std::env::temp_dir().join(format!(
            "nota-test-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let store = Store::load(dir.clone());

        // what a live site parser saves
        store
            .upsert(vec![json!({
                "id": "x:1",
                "url": "https://x.com/1",
                "savedAt": 100,
                "author": "Alice @alice",
                "text": "A long original post",
                "images": ["a.jpg"],
                "links": [{"url": "https://x.com/a", "label": "x"}],
                "tags": ["like"],
                "folder": "Reading",
                "read": true
            })])
            .unwrap();
        // an archive/import save: shorter text, no images, different tag
        store
            .upsert(vec![json!({
                "id": "x:1",
                "url": "https://x.com/1",
                "savedAt": 200,
                "author": "X archive",
                "text": "short",
                "images": [],
                "links": [],
                "tags": ["x-archive"]
            })])
            .unwrap();
        // a later live save: longer text, new images, no tags, new savedAt
        store
            .upsert(vec![json!({
                "id": "x:1",
                "url": "https://x.com/1",
                "savedAt": 300,
                "author": "Bob",
                "text": "A much longer live post body",
                "images": ["b.jpg"],
                "tags": ["bookmark"]
            })])
            .unwrap();

        store
            .upsert(vec![
                json!({"id": "x:2", "url": "https://x.com/2", "savedAt": 1, "text": "first", "tags": ["a"]}),
                json!({"id": "x:2", "url": "https://x.com/2", "savedAt": 2, "text": "second one", "tags": ["b"]}),
            ])
            .unwrap();

        {
            let notes = store.notes.lock().unwrap();
            assert_eq!(notes.len(), 2);
            assert_eq!(notes[1]["text"], "second one"); // same id twice in one batch merged
            assert_eq!(notes[1]["tags"], json!(["a", "b"]));
            assert_eq!(notes[0]["savedAt"], 100);
            assert_eq!(notes[0]["author"], "Alice @alice");
            assert_eq!(notes[0]["text"], "A much longer live post body");
            assert_eq!(notes[0]["images"], json!(["b.jpg"]));
            assert_eq!(notes[0]["links"], json!([{"url": "https://x.com/a", "label": "x"}]));
            assert_eq!(notes[0]["tags"], json!(["like", "x-archive", "bookmark"]));
            assert_eq!(notes[0]["folder"], "Reading");
            assert_eq!(notes[0]["read"], true); // app-side read state survives a re-import
        }

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn imports_skip_removed_posts_and_unchanged_saves_write_nothing() {
        let dir = std::env::temp_dir().join(format!(
            "nota-test-guard-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let store = Store::load(dir.clone());
        let live = json!({"id": "x:1", "url": "https://x.com/1", "savedAt": 1, "text": "post", "tags": ["like"]});
        let mut import = live.clone();
        import["imported"] = json!(true);

        assert!(store.upsert(vec![live.clone()]).unwrap());
        assert!(!store.upsert(vec![live.clone()]).unwrap(), "same post again changes nothing");
        assert!(!store.upsert(vec![import.clone()]).unwrap(), "re-import changes nothing");
        assert!(store.notes.lock().unwrap()[0].get("imported").is_none(), "the flag is never stored");

        store.remove(vec!["x:1".into()]).unwrap();
        assert!(!store.upsert(vec![import.clone()]).unwrap());
        assert!(store.notes.lock().unwrap().is_empty(), "import can't bring back a removed post");

        let store = Store::load(dir.clone());
        assert!(!store.upsert(vec![import.clone()]).unwrap());
        assert!(store.notes.lock().unwrap().is_empty(), "still removed after a restart");

        assert!(store.upsert(vec![live]).unwrap(), "a deliberate save restores it");
        let store = Store::load(dir.clone());
        assert!(!store.upsert(vec![import]).unwrap());
        assert_eq!(store.notes.lock().unwrap().len(), 1, "restored post stays after a restart");

        fs::remove_dir_all(&dir).unwrap();
    }
}
