//! The four signature themes of the web app, mapped to egui visuals.

use eframe::egui;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Theme {
    Light,
    Sepia,
    Night,
    OledBlack,
}

impl Theme {
    pub const ALL: [Theme; 4] = [
        Theme::Light,
        Theme::Sepia,
        Theme::Night,
        Theme::OledBlack,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Theme::Light => "☀️ Carta",
            Theme::Sepia => "📜 Sepia",
            Theme::Night => "🌙 Notte",
            Theme::OledBlack => "⬛ OLED",
        }
    }

    pub fn next(self) -> Theme {
        let all = Theme::ALL;
        all[(all.iter().position(|t| *t == self).unwrap() + 1) % all.len()]
    }
}

/// Paper and ink of each theme.
fn palette(theme: Theme) -> (&'static [u8; 3], &'static [u8; 3], bool) {
    match theme {
        // (paper, ink, dark)
        Theme::Light => (&[0xff, 0xff, 0xff], &[0x1a, 0x1a, 0x1a], false),
        Theme::Sepia => (&[0xf4, 0xec, 0xd8], &[0x4a, 0x3b, 0x2a], false),
        Theme::Night => (&[0x2e, 0x33, 0x39], &[0xd8, 0xdc, 0xe0], true),
        Theme::OledBlack => (&[0x00, 0x00, 0x00], &[0xd0, 0xd0, 0xd0], true),
    }
}

fn rgb(bytes: &[u8; 3]) -> egui::Color32 {
    egui::Color32::from_rgb(bytes[0], bytes[1], bytes[2])
}

/// The electric blue caret/accent of the web app.
pub const ACCENT: egui::Color32 =
    egui::Color32::from_rgb(0x4c, 0xb1, 0xff);

pub fn apply(ctx: &egui::Context, theme: Theme) {
    let (paper, ink, dark) = palette(theme);
    let mut visuals = if dark {
        egui::Visuals::dark()
    } else {
        egui::Visuals::light()
    };
    let paper = rgb(paper);
    let ink = rgb(ink);

    visuals.panel_fill = paper;
    visuals.window_fill = paper;
    visuals.extreme_bg_color = paper;
    visuals.faint_bg_color = paper;
    visuals.code_bg_color = if dark {
        egui::Color32::from_rgb(
            paper.r().saturating_sub(12),
            paper.g().saturating_sub(12),
            paper.b().saturating_sub(12),
        )
    } else {
        egui::Color32::from_rgb(
            paper.r().saturating_sub(6),
            paper.g().saturating_sub(6),
            paper.b().saturating_sub(6),
        )
    };
    visuals.text_edit_bg_color = Some(paper);
    visuals.hyperlink_color = ACCENT;
    visuals.selection.bg_fill = ACCENT.gamma_multiply(0.30);
    visuals.selection.stroke = egui::Stroke::new(1.0_f32, ACCENT);
    visuals.widgets.noninteractive.bg_fill = paper;
    visuals.widgets.inactive.bg_fill = paper;
    if dark {
        visuals.widgets.noninteractive.fg_stroke.color = ink;
        visuals.widgets.inactive.fg_stroke.color = ink;
    }

    // Text colors: every text style gets the theme ink.
    let mut style = (*ctx.style()).clone();
    style.visuals = visuals;
    for (_, ts) in style.text_styles.iter_mut() {
        let _ = ts;
    }
    ctx.set_style(style);
    ctx.all_styles_mut(|s| {
        s.visuals.override_text_color = Some(ink);
    });
}
