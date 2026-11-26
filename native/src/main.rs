//! TypeCraft native prototype — bootstrap.
//!
//! A Rust/egui reimplementation of the TypeCraft editor that does not need a
//! browser: same document protocol (content revisions, atomic saves, read-only
//! policy), same three view modes, same typewriter scrolling and focus
//! dimming, same four themes.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use typecraft_native::{app, theme};

use eframe::egui;

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1120.0, 780.0])
            .with_min_inner_size([680.0, 460.0]),
        ..Default::default()
    };
    eframe::run_native(
        "TypeCraft — Minimalist Markdown Editor",
        options,
        Box::new(|cc| {
            install_fonts(&cc.egui_ctx);
            theme::apply(&cc.egui_ctx, theme::Theme::IaLight);
            Ok(Box::new(app::TypeCraftApp::new()))
        }),
    )
}

/// Embed the authentic iA Writer fonts already shipped with the web app:
/// Mono for the editor, Duo/Quattro for proportional UI text and headings.
fn install_fonts(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();

    let mono = egui::FontData::from_static(include_bytes!(
        "../../web/static/fonts/iAWriterMono.ttf"
    ));
    let duo = egui::FontData::from_static(include_bytes!(
        "../../web/static/fonts/iAWriterDuo.ttf"
    ));
    let quattro = egui::FontData::from_static(include_bytes!(
        "../../web/static/fonts/iAWriterQuattro.ttf"
    ));

    fonts.font_data.insert("IAWriterMono".into(), mono.into());
    fonts.font_data.insert("IAWriterDuo".into(), duo.into());
    fonts.font_data.insert("IAWriterQuattro".into(), quattro.into());

    // The editor is monospace; the UI/preview text is the proportional Quattro.
    fonts
        .families
        .entry(egui::FontFamily::Monospace)
        .or_default()
        .insert(0, "IAWriterMono".into());
    fonts
        .families
        .entry(egui::FontFamily::Proportional)
        .or_default()
        .insert(0, "IAWriterQuattro".into());

    ctx.set_fonts(fonts);
}
