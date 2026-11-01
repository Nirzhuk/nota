// Nota: local listener on 127.0.0.1:4317 that the extension POSTs notes to.
// Notes are stored as raw JSON (schema owned by the frontend) in notes.json.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
mod hover;

use serde_json::Value;
use std::{fs, io::Read, path::PathBuf, sync::Mutex};
use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State, Wry};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;

const ADDR: &str = "127.0.0.1:4317";

struct Store {
    path: PathBuf,
    notes: Mutex<Vec<Value>>,
    folders_path: PathBuf,
    folders: Mutex<Vec<String>>,
    settings_path: PathBuf,
    settings: Mutex<serde_json::Map<String, Value>>, // sound, hoverKey, theme (see settings.tsx)
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
        Store {
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

    fn upsert(&self, incoming: Vec<Value>) -> std::io::Result<()> {
        let mut notes = self.notes.lock().unwrap();
        for n in incoming {
            let Some(id) = n.get("id").and_then(Value::as_str) else { continue };
            if n.get("url").and_then(Value::as_str).is_none() {
                continue;
            }
            match notes.iter().position(|o| o["id"] == id) {
                // Re-like / re-import refreshes content without losing richer live
                // data, app-side fields like `folder`, or the original savedAt.
                Some(i) => {
                    let old = notes[i].take();
                    let old_tags = tags_of(&old);
                    let mut merged = merge_note(old, n);
                    merge_tags(&mut merged, old_tags);
                    notes[i] = merged;
                }
                None => notes.push(n),
            }
        }
        self.save(&notes)
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

#[tauri::command]
fn list_notes(store: State<Store>) -> Vec<Value> {
    store.notes.lock().unwrap().clone()
}

// Bulk import from X's like.js archive. Upsert merges tags/folder into existing notes.
#[tauri::command]
fn import_notes(app: AppHandle, store: State<Store>, notes: Vec<Value>) -> Result<usize, String> {
    let count = notes.len();
    enrich(&app, &notes);
    store.upsert(notes).map_err(|e| e.to_string())?;
    let _ = app.emit("notes-changed", ());
    Ok(count)
}

// Merge fields into a note; null removes the field. Used for `folder`.
#[tauri::command]
fn update_note(store: State<Store>, id: String, patch: serde_json::Map<String, Value>) -> Result<(), String> {
    let mut notes = store.notes.lock().unwrap();
    let Some(Value::Object(note)) = notes.iter_mut().find(|n| n["id"] == id.as_str()) else {
        return Err(format!("no note {id}"));
    };
    for (k, v) in patch {
        if v.is_null() {
            note.remove(&k);
        } else {
            note.insert(k, v);
        }
    }
    store.save(&notes).map_err(|e| e.to_string())
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
#[tauri::command]
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
    let _ = app.opener().reveal_item_in_dir(&app.state::<Store>().path);
}

#[tauri::command]
fn delete_note(store: State<Store>, id: String) -> Result<(), String> {
    let mut notes = store.notes.lock().unwrap();
    notes.retain(|n| n["id"] != id.as_str());
    store.save(&notes).map_err(|e| e.to_string())
}

fn listen(app: AppHandle) {
    let server = match tiny_http::Server::http(ADDR) {
        Ok(s) => s,
        Err(e) => return eprintln!("nota: can't listen on {ADDR}: {e}"),
    };
    for mut req in server.incoming_requests() {
        // X-Nota forces a CORS preflight, so random web pages can't post here
        let ok_header = req.headers().iter().any(|h| h.field.equiv("X-Nota"));
        let status = match (req.method(), req.url(), ok_header) {
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
            _ => 404,
        };
        let _ = req.respond(tiny_http::Response::empty(status));
    }
}

fn save(app: &AppHandle, notes: Vec<Value>) -> u16 {
    enrich(app, &notes);
    match app.state::<Store>().upsert(notes) {
        Ok(()) => {
            let _ = app.emit("notes-changed", ());
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
    let out = std::process::Command::new("curl")
        .args(["-sL", "--max-time", "8", "--compressed", "-H", "Accept-Language: en"])
        .args(["-A", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"])
        .arg(url)
        .output()
        .ok()?;
    let html = String::from_utf8_lossy(&out.stdout);
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

fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, label: &str, key: &str| MenuItemBuilder::with_id(id, label).accelerator(key).build(app);
    let nota = SubmenuBuilder::new(app, "Nota")
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

fn show_search(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    let _ = app.emit("menu", "search");
}

// Alt+Shift+Space (Alt+Space is Raycast's): bring Nota forward and focus search.
// Alt+Cmd+S: save the clipboard link. Double-tap Shift: save the hovered link (hover.rs).
fn global_shortcuts(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    hover::watch(app.clone());
    let show = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::Space);
    let clip = Shortcut::new(Some(Modifiers::ALT | Modifiers::SUPER), Code::KeyS);
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .menu(menu)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "reveal" => {
                let _ = app.opener().reveal_item_in_dir(&app.state::<Store>().path);
            }
            // search / filter:* are handled by the frontend
            id => {
                let _ = app.emit("menu", id);
            }
        })
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            app.manage(Store::load(dir));
            apply_theme(app.handle());
            global_shortcuts(app.handle());
            let handle = app.handle().clone();
            std::thread::spawn(move || listen(handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_notes,
            delete_note,
            update_note,
            import_notes,
            list_folders,
            set_folders,
            rename_folder,
            get_settings,
            set_settings,
            reveal_notes
        ])
        .run(tauri::generate_context!())
        .expect("error while running nota");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

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
                "folder": "Read"
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

        {
            let notes = store.notes.lock().unwrap();
            assert_eq!(notes.len(), 1);
            assert_eq!(notes[0]["savedAt"], 100);
            assert_eq!(notes[0]["author"], "Alice @alice");
            assert_eq!(notes[0]["text"], "A much longer live post body");
            assert_eq!(notes[0]["images"], json!(["b.jpg"]));
            assert_eq!(notes[0]["links"], json!([{"url": "https://x.com/a", "label": "x"}]));
            assert_eq!(notes[0]["tags"], json!(["like", "x-archive", "bookmark"]));
            assert_eq!(notes[0]["folder"], "Read");
        }

        fs::remove_dir_all(&dir).unwrap();
    }
}
