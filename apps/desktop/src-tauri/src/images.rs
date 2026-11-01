// Offline copies of note images: <app data>/images/<hash of the remote URL>.
// notes.json keeps the remote URLs, so it stays portable, and a missing copy just falls back to the link.
use crate::{setting, Store, BROWSER_UA};
use percent_encoding::percent_decode_str;
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc::{channel, Sender},
};
use tauri::{http::Response, AppHandle, Manager, State};

const MAX_BYTES: u64 = 25 << 20;

pub struct Images {
    dir: PathBuf,
    queue: Sender<String>,
}

pub fn start(app: &AppHandle, dir: PathBuf) {
    let (queue, urls) = channel::<String>();
    app.manage(Images { dir: dir.clone(), queue });
    let app = app.clone();
    std::thread::spawn(move || {
        let notes = app.state::<Store>().notes.lock().unwrap().clone();
        prune(&dir, &notes);
        drop(notes);
        // ponytail: one download at a time and the queue dies on quit, so an interrupted
        // import keeps remote links. Persist the queue if that loses images in practice.
        for url in urls {
            // read per URL so turning the setting off also stops a running import
            if setting(&app, "keepImages") == Value::Bool(false) || dir.join(name_of(&url)).exists() {
                continue;
            }
            if let Some(bytes) = download(&url) {
                if let Err(e) = store_copy(&dir, &url, &bytes) {
                    eprintln!("nota: can't keep image: {e}");
                }
            }
        }
    });
}

// Call before upsert: a bulk import can't bring back a removed post, so don't download its images.
pub fn queue_notes(app: &AppHandle, notes: &[Value]) {
    let store = app.state::<Store>();
    let removed = store.removed.lock().unwrap();
    for n in notes {
        let skipped = n.get("imported").is_some() && n["id"].as_str().is_some_and(|id| removed.contains(id));
        if !skipped {
            urls_of(n).into_iter().for_each(|url| queue_url(app, url));
        }
    }
}

pub fn queue_url(app: &AppHandle, url: String) {
    let _ = app.state::<Images>().queue.send(url);
}

// The URLs a card shows (card.tsx). YouTube cards show a poster built from the video id.
fn urls_of(note: &Value) -> Vec<String> {
    if note["source"] == "youtube" {
        let id = note["id"].as_str().and_then(|id| id.strip_prefix("youtube:"));
        return id.map(|id| format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg")).into_iter().collect();
    }
    note["images"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|url| url.starts_with("http"))
        .map(str::to_string)
        .collect()
}

// FNV-1a, not std's DefaultHasher: its output can change between Rust releases, which would orphan every file.
fn name_of(url: &str) -> String {
    let hash = url.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| (h ^ b as u64).wrapping_mul(0x0100_0000_01b3));
    format!("{hash:016x}")
}

// Only real image formats are kept, so an error page or a script can't be stored and served back.
fn mime_of(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("image/webp"),
        [_, _, _, _, b'f', b't', b'y', b'p', b'a', b'v', b'i', ..] => Some("image/avif"),
        _ => None,
    }
}

// ponytail: system curl, same as fetch_og in main.rs.
fn download(url: &str) -> Option<Vec<u8>> {
    let mut curl = Command::new("curl");
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut curl, 0x0800_0000); // CREATE_NO_WINDOW: no console flash
    let mut child = curl
        .args(["-sfL", "--globoff", "--max-time", "30", "--proto", "=http,https", "--proto-redir", "=http,https"])
        .args(["-A", BROWSER_UA])
        .arg(url)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut bytes = Vec::new();
    let read = child.stdout.take()?.take(MAX_BYTES + 1).read_to_end(&mut bytes);
    let too_big = bytes.len() as u64 > MAX_BYTES;
    if too_big {
        let _ = child.kill();
    }
    let finished = child.wait().is_ok_and(|status| status.success());
    (read.is_ok() && !too_big && finished && mime_of(&bytes).is_some()).then_some(bytes)
}

// write to tmp + rename so a half-written file is never served
fn store_copy(dir: &Path, url: &str, bytes: &[u8]) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let path = dir.join(name_of(url));
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(tmp, path)
}

// Removing a card leaves its file until the next launch, so Undo keeps the copy.
fn prune(dir: &Path, notes: &[Value]) {
    // A notes.json that failed to load reads as empty: never delete the images along with it.
    if notes.is_empty() {
        return;
    }
    let keep: HashSet<String> = notes.iter().flat_map(urls_of).map(|url| name_of(&url)).collect();
    for file in fs::read_dir(dir).into_iter().flatten().flatten() {
        if !keep.contains(file.file_name().to_string_lossy().as_ref()) {
            let _ = fs::remove_file(file.path());
        }
    }
}

// The hash in name_of means the request path can't reach outside the images folder.
fn read_copy(dir: &Path, request_path: &str) -> Option<(Vec<u8>, &'static str)> {
    let url = percent_decode_str(request_path.trim_start_matches('/')).decode_utf8_lossy();
    let bytes = fs::read(dir.join(name_of(&url))).ok()?;
    let mime = mime_of(&bytes)?;
    Some((bytes, mime))
}

// notaimg:// (see main.rs). A 404 makes the card fall back to the remote URL.
pub fn serve(app: &AppHandle, request_path: &str) -> Response<Vec<u8>> {
    let response = Response::builder();
    match read_copy(&app.state::<Images>().dir, request_path) {
        Some((bytes, mime)) => response.header("Content-Type", mime).body(bytes),
        None => response.status(404).body(Vec::new()),
    }
    .expect("static response headers are valid")
}

#[tauri::command(async)] // off the main thread: scales with image count
pub fn images_size(images: State<Images>) -> u64 {
    fs::read_dir(&images.dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|file| file.metadata().ok())
        .map(|meta| meta.len())
        .sum()
}

#[tauri::command(async)] // off the main thread: scales with image count
pub fn clear_images(images: State<Images>) -> Result<(), String> {
    match fs::remove_dir_all(&images.dir) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        io::Write,
        net::TcpListener,
        time::{SystemTime, UNIX_EPOCH},
    };

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 1, 2, 3];

    fn temp_dir() -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("nota-images-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    // Answers each connection in order, then closes.
    fn serve_once(responses: Vec<(&'static str, Vec<u8>)>) -> String {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/image", server.local_addr().unwrap());
        std::thread::spawn(move || {
            for (status, body) in responses {
                let (mut socket, _) = server.accept().unwrap();
                let mut request = [0; 4096];
                let _ = socket.read(&mut request);
                let head = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                socket.write_all(head.as_bytes()).unwrap();
                socket.write_all(&body).unwrap();
            }
        });
        url
    }

    #[test]
    fn keeps_real_images_and_rejects_everything_else() {
        let url = serve_once(vec![
            ("200 OK", PNG.to_vec()),
            ("200 OK", b"<html>not an image</html>".to_vec()),
            ("404 Not Found", PNG.to_vec()),
        ]);
        assert_eq!(download(&url).as_deref(), Some(PNG));
        assert_eq!(download(&url), None);
        assert_eq!(download(&url), None);
    }

    #[test]
    fn serves_a_copy_from_the_encoded_request_path() {
        let dir = temp_dir();
        let url = "https://cdn.example/a b.png?x=1";
        store_copy(&dir, url, PNG).unwrap();
        let encoded = "/https%3A%2F%2Fcdn.example%2Fa%20b.png%3Fx%3D1";
        assert_eq!(read_copy(&dir, encoded), Some((PNG.to_vec(), "image/png")));
        assert_eq!(read_copy(&dir, "/https%3A%2F%2Fother.example%2Fmissing.png"), None);
        assert_eq!(read_copy(&dir, "/..%2F..%2Fnotes.json"), None);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn prune_removes_orphans_but_never_on_an_empty_library() {
        let dir = temp_dir();
        let kept = "https://cdn.example/kept.png";
        let poster = "https://i.ytimg.com/vi/abc/hqdefault.jpg";
        let orphan = "https://cdn.example/orphan.png";
        for url in [kept, poster, orphan] {
            store_copy(&dir, url, PNG).unwrap();
        }

        prune(&dir, &[]);
        assert!(dir.join(name_of(orphan)).exists());

        prune(&dir, &[json!({ "source": "x", "images": [kept] }), json!({ "source": "youtube", "id": "youtube:abc" })]);
        assert!(dir.join(name_of(kept)).exists());
        assert!(dir.join(name_of(poster)).exists());
        assert!(!dir.join(name_of(orphan)).exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn hash_is_stable_across_releases() {
        assert_eq!(name_of("a"), "af63dc4c8601ec8c"); // renaming this hash orphans every saved image
    }
}
