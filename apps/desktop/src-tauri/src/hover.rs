// Double-tap Shift in any app: save the link under the pointer (Discord, Slack, Notes, Safari, …).
// The link is read through the macOS Accessibility API, so Nota needs Accessibility access.
// Chromium browsers are skipped: the extension handles those and builds richer notes (X posts etc.).
use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::{CFString, CFStringRef};
use core_foundation::url::CFURL;
use std::ffi::c_void;
use std::ptr::null;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const BROWSERS: &[&str] = &[
    "Google Chrome", "Google Chrome Canary", "Chromium", "Arc", "Brave Browser",
    "Microsoft Edge", "Vivaldi", "Opera", "Dia",
];

#[repr(C)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateSystemWide() -> CFTypeRef;
    fn AXUIElementCreateApplication(pid: i32) -> CFTypeRef;
    fn AXUIElementCopyElementAtPosition(el: CFTypeRef, x: f32, y: f32, out: *mut CFTypeRef) -> i32;
    fn AXUIElementCopyAttributeValue(el: CFTypeRef, attr: CFStringRef, out: *mut CFTypeRef) -> i32;
    fn AXUIElementSetAttributeValue(el: CFTypeRef, attr: CFStringRef, value: CFTypeRef) -> i32;
    fn AXUIElementGetPid(el: CFTypeRef, pid: *mut i32) -> i32;
    fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> bool;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceFlagsState(state: i32) -> u64;
    fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
    fn CGEventCreate(source: *const c_void) -> CFTypeRef;
    fn CGEventGetLocation(event: CFTypeRef) -> CGPoint;
}

// Polls the modifier state, which needs no permission (only reading the link does).
// ponytail: 15ms poll; move to a CGEventTap if it ever needs to be exact.
pub fn watch(app: AppHandle) {
    const HID: i32 = 1;
    const KEY_DOWN: u32 = 10;
    const SHIFT: u64 = 0x2_0000;
    const MODS: u64 = 0x1E_0000; // shift | ctrl | option | cmd (ignores caps lock, fn)
    const WINDOW: Duration = Duration::from_millis(400); // tune: max gap between the two presses
    std::thread::spawn(move || {
        let (mut prev, mut first) = (0u64, None::<Instant>);
        loop {
            std::thread::sleep(Duration::from_millis(15));
            let flags = unsafe { CGEventSourceFlagsState(HID) } & MODS;
            if flags == prev {
                continue;
            }
            if flags == SHIFT && prev == 0 {
                // a letter typed between the taps ("Hi There") means typing, not a double tap
                let since_key = unsafe { CGEventSourceSecondsSinceLastEventType(HID, KEY_DOWN) };
                match first {
                    Some(t) if t.elapsed() < WINDOW && since_key > t.elapsed().as_secs_f64() => {
                        first = None;
                        save_hovered(&app);
                    }
                    _ => first = Some(Instant::now()),
                }
            } else if flags != 0 {
                first = None; // another modifier joined in: not a plain Shift tap
            }
            prev = flags;
        }
    });
}

fn save_hovered(app: &AppHandle) {
    let prompt = CFDictionary::from_CFType_pairs(&[(
        CFString::new("AXTrustedCheckOptionPrompt"),
        CFBoolean::true_value(),
    )]);
    if !unsafe { AXIsProcessTrustedWithOptions(prompt.as_CFTypeRef()) } {
        let _ = app.emit("toast", "Allow Nota in System Settings → Privacy & Security → Accessibility");
        return;
    }
    let (x, y) = unsafe {
        let e = CGEventCreate(null());
        if e.is_null() {
            return;
        }
        let p = CGEventGetLocation(e);
        drop(CFType::wrap_under_create_rule(e));
        (p.x as f32, p.y as f32)
    };
    let sys = unsafe { CFType::wrap_under_create_rule(AXUIElementCreateSystemWide()) };
    let Some(owner) = app_at(&sys, x, y) else { return };
    if BROWSERS.contains(&text(&owner, "AXTitle").unwrap_or_default().as_str()) {
        return; // the extension saves it
    }
    let mut found = link_at(&sys, x, y);
    if found.is_none() {
        // Electron apps (Discord, Slack) only build their accessibility tree once asked.
        let on = CFString::new("AXManualAccessibility");
        let set = unsafe {
            AXUIElementSetAttributeValue(owner.as_CFTypeRef(), on.as_concrete_TypeRef(), CFBoolean::true_value().as_CFTypeRef())
        };
        if set == 0 {
            std::thread::sleep(Duration::from_millis(250));
            found = link_at(&sys, x, y);
        }
    }
    let Some((url, title)) = found else { return }; // nothing under the pointer: stay quiet
    if crate::save_link(app, &url, &title, &[]) {
        play_save_sound();
        let _ = app.emit("toast", "Saved link to Nota");
    } else {
        let _ = app.emit("toast", "Couldn't save link");
    }
}

// A short pencil scribble that fades out (sounds/save.wav, generated for Nota).
// Embedded so it ships inside the binary; afplay needs a file, so it's written to tmp once.
fn play_save_sound() {
    static PATH: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();
    let path = PATH.get_or_init(|| {
        let p = std::env::temp_dir().join("nota-save.wav");
        let _ = std::fs::write(&p, include_bytes!("../sounds/save.wav"));
        p
    });
    let _ = std::process::Command::new("afplay").args(["-v", "0.35"]).arg(path).spawn(); // volume, tune 0 to 1
}

fn element_at(sys: &CFType, x: f32, y: f32) -> Option<CFType> {
    let mut out: CFTypeRef = null();
    let err = unsafe { AXUIElementCopyElementAtPosition(sys.as_CFTypeRef(), x, y, &mut out) };
    (err == 0 && !out.is_null()).then(|| unsafe { CFType::wrap_under_create_rule(out) })
}

fn app_at(sys: &CFType, x: f32, y: f32) -> Option<CFType> {
    let el = element_at(sys, x, y)?;
    let mut pid = 0;
    if unsafe { AXUIElementGetPid(el.as_CFTypeRef(), &mut pid) } != 0 {
        return None;
    }
    let app = unsafe { AXUIElementCreateApplication(pid) };
    (!app.is_null()).then(|| unsafe { CFType::wrap_under_create_rule(app) })
}

// The element under the pointer is usually the link's text; walk up to the AXLink.
fn link_at(sys: &CFType, x: f32, y: f32) -> Option<(String, String)> {
    let mut el = element_at(sys, x, y)?;
    for _ in 0..8 {
        if let Some(url) = attr(&el, "AXURL").and_then(|u| u.downcast::<CFURL>()) {
            let url = url.get_string().to_string();
            if !url.starts_with("http") {
                return None;
            }
            let title = ["AXTitle", "AXDescription", "AXValue"]
                .iter()
                .find_map(|a| text(&el, a))
                .unwrap_or_else(|| url.clone());
            return Some((url, title));
        }
        el = attr(&el, "AXParent")?;
    }
    None
}

fn attr(el: &CFType, name: &str) -> Option<CFType> {
    let mut out: CFTypeRef = null();
    let key = CFString::new(name);
    let err = unsafe { AXUIElementCopyAttributeValue(el.as_CFTypeRef(), key.as_concrete_TypeRef(), &mut out) };
    (err == 0 && !out.is_null()).then(|| unsafe { CFType::wrap_under_create_rule(out) })
}

fn text(el: &CFType, name: &str) -> Option<String> {
    let s = attr(el, name)?.downcast::<CFString>()?.to_string();
    (!s.trim().is_empty()).then_some(s)
}
