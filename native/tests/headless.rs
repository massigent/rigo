//! Headless UI tests: drive the real `RigoApp::render` with a bare
//! `egui::Context` (no window, no display) and verify the document protocol
//! end to end through the same code path the native shell uses.

use std::path::PathBuf;

use rigo_native::app::{ConfirmDiscard, RigoApp, ViewMode};
use rigo_native::doc;

fn tmp_file(tag: &str) -> PathBuf {
    static COUNTER: std::sync::atomic::AtomicUsize =
        std::sync::atomic::AtomicUsize::new(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let mut p = std::env::temp_dir();
    p.push(format!("rigo-headless-{tag}-{}-{n}.md", std::process::id()));
    p
}

/// Render a few frames in every view mode and theme: must not panic, with or
/// without a document.
fn render_frames(app: &mut RigoApp, frames: usize) {
    for frame in 0..frames {
        let input = egui::RawInput::default();
        let ctx = egui::Context::default();
        ctx.run(input, |ctx| {
            app.render(ctx);
            // Exercise the modes too: raw/live/split, focus cycling, themes.
            if frame == 0 {
                app.view = ViewMode::Live;
                app.focus = rigo_native::focus::FocusMode::Sentence;
            } else if frame == 1 {
                app.view = ViewMode::Split;
                app.focus = rigo_native::focus::FocusMode::Paragraph;
                app.theme = rigo_native::theme::Theme::OledBlack;
            } else {
                app.view = ViewMode::Raw;
                app.focus = rigo_native::focus::FocusMode::Off;
                app.theme = rigo_native::theme::Theme::Light;
            }
        });
    }
}

#[test]
fn renders_in_every_mode_without_a_display() {
    let mut app = RigoApp::new();
    render_frames(&mut app, 3);

    // Richer document: headings, lists, code fences, long wrapped lines.
    let md = "# Titolo\n\nParagraph with **bold**, *italic*, `code`.\n\n\
              - [ ] task uno\n- [x] task due\n\n```rust\nfn main() {}\n```\n\n\
              > A quote\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n";
    app.text = md.to_string();
    app.outline_open = true;
    render_frames(&mut app, 3);
}

#[test]
fn typing_marks_dirty_and_autosave_persists_with_the_protocol() {
    let path = tmp_file("autosave");

    let mut app = RigoApp::new();
    // The document must really exist on disk: the protocol compares against
    // the real snapshot, never against a fabricated one.
    std::fs::write(&path, "uno").unwrap();
    let snap = doc::read_snapshot(&path).unwrap();
    app.adopt_snapshot(path.clone(), &snap);

    // Simulated typing: the buffer diverges from the disk baseline.
    app.text = "uno due".into();
    app.mark_edited();
    assert!(app.dirty);
    assert_eq!(app.status, "○ Modificato");

    // The debounced autosave is time-based; call the save directly (the same
    // method the timer calls).
    app.text = "uno due tre".into();
    app.mark_edited();
    // Save through the same code path as autosave (explicit here).
    app.save_for_tests();

    assert!(!app.dirty);
    assert_eq!(app.status, "● Salvato");
    let on_disk = std::fs::read_to_string(&path).unwrap();
    assert_eq!(on_disk, "uno due tre");
    assert_eq!(
        app.disk_revision,
        doc::content_revision(on_disk.as_bytes())
    );

    let _ = std::fs::remove_file(&path);
}

#[test]
fn external_change_on_clean_buffer_is_adopted_by_the_watchdog() {
    let path = tmp_file("watchdog");
    std::fs::write(&path, "originale").unwrap();

    let mut app = RigoApp::new();
    let snap = doc::read_snapshot(&path).unwrap();
    app.adopt_snapshot(path.clone(), &snap);

    // External edit while the buffer is clean: the watchdog reloads it.
    std::fs::write(&path, "cambiato fuori").unwrap();
    app.watchdog_tick_for_tests();

    assert_eq!(app.text, "cambiato fuori");
    assert!(!app.dirty);
    assert_eq!(app.status, "● Ricaricato dal disco");
    assert_eq!(
        app.disk_revision,
        doc::content_revision(b"cambiato fuori")
    );

    let _ = std::fs::remove_file(&path);
}

#[test]
fn external_change_on_dirty_buffer_only_warns() {
    let path = tmp_file("watchdog-dirty");
    std::fs::write(&path, "originale").unwrap();

    let mut app = RigoApp::new();
    let snap = doc::read_snapshot(&path).unwrap();
    app.adopt_snapshot(path.clone(), &snap);

    app.text = "modifica interna".into();
    app.mark_edited();

    std::fs::write(&path, "cambiato fuori").unwrap();
    app.watchdog_tick_for_tests();

    // The in-progress edit wins the screen; the warning appears.
    assert_eq!(app.text, "modifica interna");
    assert!(app.dirty);
    assert_eq!(app.status, "⚠️ Cambiato su disco");

    let _ = std::fs::remove_file(&path);
}

#[test]
fn missing_file_is_never_recreated_by_a_stale_save() {
    let path = tmp_file("missing");
    std::fs::write(&path, "baseline").unwrap();

    let mut app = RigoApp::new();
    let snap = doc::read_snapshot(&path).unwrap();
    app.adopt_snapshot(path.clone(), &snap);

    // The file disappears on disk; a save with the stale baseline refuses to
    // resurrect it, like the Go app.
    std::fs::remove_file(&path).unwrap();
    app.save_for_tests();

    assert!(!path.exists());
    assert_eq!(app.status, "⚠️ File rimosso su disco");
}

#[test]
fn read_only_document_is_locked_and_reports_itself() {
    let path = tmp_file("readonly");
    std::fs::write(&path, "protetto").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            &path,
            std::fs::Permissions::from_mode(0o444),
        )
        .unwrap();
    }

    let mut app = RigoApp::new();
    let snap = doc::read_snapshot(&path).unwrap();
    app.adopt_snapshot(path.clone(), &snap);
    assert!(app.read_only);
    assert_eq!(app.status, "🔒 Sola lettura");

    // A read-only document never autosaves, and an explicit save explains.
    app.save_for_tests();
    assert!(app.status.contains("Sola lettura"));

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(
            &path,
            std::fs::Permissions::from_mode(0o644),
        )
        .unwrap();
    }
    let _ = std::fs::remove_file(&path);
}

#[test]
fn new_document_needs_confirmation_only_when_dirty() {
    let mut app = RigoApp::new();
    // The welcome buffer is clean: no confirmation dialog is queued.
    app.handle_shortcut_new_for_tests();
    assert!(app.confirm_discard.is_none());
    assert_eq!(app.text, "");

    app.text = "bozza".into();
    app.mark_edited();
    app.handle_shortcut_new_for_tests();
    assert_eq!(app.confirm_discard, Some(ConfirmDiscard::New));
    // The dialog is part of the render: must not panic headlessly.
    render_frames(&mut app, 1);
}

#[test]
fn line_col_and_caret_helpers() {
    let text = "abc\ndef\ng";
    // caret on the second line, after "d".
    let (line, col) = rigo_native::app::line_col_for_tests(text, 5);
    assert_eq!((line, col), (2, 2));
    let (line, col) = rigo_native::app::line_col_for_tests(text, 0);
    assert_eq!((line, col), (1, 1));
    // Clamped far beyond the end.
    let (line, col) = rigo_native::app::line_col_for_tests(text, 999);
    assert_eq!((line, col), (3, 2));
}
