//! Rigo native prototype — bootstrap.
//!
//! A Rust/egui reimplementation of the Rigo editor that does not need a
//! browser: same document protocol (content revisions, atomic saves, read-only
//! policy), same three view modes, same typewriter scrolling and focus
//! dimming, same four themes.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rigo_native::{app, theme};

use eframe::egui;

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1120.0, 780.0])
            .with_min_inner_size([680.0, 460.0]),
        ..Default::default()
    };
    eframe::run_native(
        "Rigo — Minimalist Markdown Editor",
        options,
        Box::new(|cc| {
            install_fonts(&cc.egui_ctx);
            theme::apply(&cc.egui_ctx, theme::Theme::Light);
            Ok(Box::new(app::RigoApp::new()))
        }),
    )
}

/// Embed the IBM Plex fonts bundled with the native app:
/// Mono for the editor, Sans for proportional UI text and headings.
fn install_fonts(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();

    let mono = egui::FontData::from_static(include_bytes!(
        "../assets/fonts/IBMPlexMono-Regular.ttf"
    ));
    let sans = egui::FontData::from_static(include_bytes!(
        "../assets/fonts/IBMPlexSans-Regular.ttf"
    ));
    let serif = egui::FontData::from_static(include_bytes!(
        "../assets/fonts/IBMPlexSerif-Regular.ttf"
    ));

    fonts.font_data.insert("IBMPlexMono".into(), mono.into());
    fonts.font_data.insert("IBMPlexSans".into(), sans.into());
    fonts.font_data.insert("IBMPlexSerif".into(), serif.into());

    // The editor is monospace; the UI/preview text uses IBM Plex Sans.
    fonts
        .families
        .entry(egui::FontFamily::Monospace)
        .or_default()
        .insert(0, "IBMPlexMono".into());
    fonts
        .families
        .entry(egui::FontFamily::Proportional)
        .or_default()
        .insert(0, "IBMPlexSans".into());

    ctx.set_fonts(fonts);
}
