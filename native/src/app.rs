//! The native application: editor pane, markdown preview, typewriter
//! scrolling, focus dimming, document protocol wiring and shortcuts.
//!
//! The UI render is separated from the eframe shell (`update` just calls
//! [`RigoApp::render`]) so headless tests can drive the same code with a
//! bare `egui::Context`.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use eframe::egui;
use egui::text_edit::TextEditState;
use egui::text::{CCursor, CCursorRange};

use crate::doc::{self, DiskSnapshot, SaveError};
use crate::focus::{self, FocusMode};
use crate::markdown;
use crate::theme::{self, Theme};

const EDITOR_ID: &str = "rigo-editor";
const AUTOSAVE_DELAY: Duration = Duration::from_millis(600);
const WATCH_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViewMode {
    Raw,
    Live,
    Split,
}

impl ViewMode {
    fn label(self) -> &'static str {
        match self {
            ViewMode::Raw => "Focus",
            ViewMode::Live => "Live",
            ViewMode::Split => "Dual",
        }
    }

    fn shows_preview(self) -> bool {
        !matches!(self, ViewMode::Raw)
    }

    fn shows_editor(self) -> bool {
        !matches!(self, ViewMode::Live)
    }
}

pub struct RigoApp {
    pub text: String,
    pub path: Option<PathBuf>,
    /// Opaque content revision of the disk file the buffer was last aligned
    /// with ("" = no baseline known, a brand-new untitled buffer).
    pub disk_revision: String,
    pub dirty: bool,
    pub read_only: bool,
    pub status: String,

    pub view: ViewMode,
    pub focus: FocusMode,
    pub typewriter: bool,
    pub theme: Theme,
    pub outline_open: bool,

    /// Confirm dialog for losing an unsaved buffer (New/Open).
    pub confirm_discard: Option<ConfirmDiscard>,

    /// Next explicit save after a conflict carries a one-shot overwrite.
    force_next: bool,

    last_edit: Option<Instant>,
    last_watch: Instant,
    /// Caret char index as of the previous frame.
    last_caret: usize,
    /// Outline click: caret to move to before the editor renders.
    jump_target: Option<usize>,
    /// Theme currently applied to the context (the last one rendered).
    applied_theme: Theme,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConfirmDiscard {
    New,
    Open,
}

impl Default for RigoApp {
    fn default() -> Self {
        Self::new()
    }
}

impl RigoApp {
    pub fn new() -> Self {
        Self {
            text: welcome_markdown(),
            path: None,
            disk_revision: String::new(),
            dirty: false,
            read_only: false,
            status: "● Salvato".into(),
            view: ViewMode::Raw,
            focus: FocusMode::Off,
            typewriter: true,
            theme: Theme::Light,
            outline_open: false,
            confirm_discard: None,
            force_next: false,
            last_edit: None,
            last_watch: Instant::now(),
            last_caret: 0,
            jump_target: None,
            applied_theme: Theme::Light,
        }
    }

    /// The whole UI. Also callable headlessly (tests) with a bare Context.
    pub fn render(&mut self, ctx: &egui::Context) {
        self.handle_shortcuts(ctx);
        self.autosave_tick();
        self.watch_tick();

        self.top_bar(ctx);
        self.status_bar(ctx);
        if self.outline_open {
            self.outline_panel(ctx);
        }
        if self.view.shows_preview() {
            // In split mode the preview is a side panel; in live mode it is
            // the whole central panel.
            if self.view == ViewMode::Split {
                egui::SidePanel::right("preview")
                    .default_width(ctx.screen_rect().width() * 0.45)
                    .min_width(240.0)
                    .frame(egui::Frame::NONE.inner_margin(egui::Margin::same(10)))
                    .show(ctx, |ui| self.preview_pane(ui));
            } else {
                egui::CentralPanel::default()
                    .frame(egui::Frame::NONE.inner_margin(egui::Margin::same(16)))
                    .show(ctx, |ui| self.preview_pane(ui));
            }
        }
        if self.view.shows_editor() {
            egui::CentralPanel::default()
                .frame(
                    egui::Frame::NONE
                        .inner_margin(egui::Margin::symmetric(16, 12)),
                )
                .show(ctx, |ui| self.editor_pane(ui));
        }

        self.confirm_dialog(ctx);
    }

    // ------------------------------------------------------------- shortcuts

    fn handle_shortcuts(&mut self, ctx: &egui::Context) {
        ctx.input(|i| {
            let cmd = i.modifiers.command;
            let shift = i.modifiers.shift;
            let alt = i.modifiers.alt;

            if cmd && shift && i.key_pressed(egui::Key::S) {
                self.prompt_save_as();
            } else if cmd && !shift && i.key_pressed(egui::Key::S) {
                self.save_explicit();
            }
            if cmd && shift && i.key_pressed(egui::Key::O) {
                self.outline_open = !self.outline_open;
            } else if cmd && !shift && i.key_pressed(egui::Key::O) {
                if self.dirty {
                    self.confirm_discard = Some(ConfirmDiscard::Open);
                } else if let Some(picked) = pick_open_file() {
                    self.open_picked_file(picked);
                }
            }
            if cmd && i.key_pressed(egui::Key::N) {
                if self.dirty {
                    self.confirm_discard = Some(ConfirmDiscard::New);
                } else {
                    self.new_document();
                }
            }
            if cmd && i.key_pressed(egui::Key::D) {
                self.focus = self.focus.cycle();
            }
            if cmd && !alt && i.key_pressed(egui::Key::T) {
                self.typewriter = !self.typewriter;
            }
            if cmd && i.key_pressed(egui::Key::Num1) {
                self.view = ViewMode::Raw;
            }
            if cmd && i.key_pressed(egui::Key::Num2) {
                self.view = ViewMode::Live;
            }
            if cmd && i.key_pressed(egui::Key::Num3) {
                self.view = ViewMode::Split;
            }
        });
    }

    // ------------------------------------------------------------ timers

    fn autosave_tick(&mut self) {
        if !self.dirty || self.read_only || self.path.is_none() {
            return;
        }
        if let Some(last) = self.last_edit {
            if last.elapsed() >= AUTOSAVE_DELAY {
                self.last_edit = None;
                self.autosave_now();
            }
        }
    }

    fn watch_tick(&mut self) {
        if self.path.is_none() || self.last_watch.elapsed() < WATCH_INTERVAL {
            return;
        }
        self.last_watch = Instant::now();
        let Some(path) = self.path.clone() else { return };

        let snap = match doc::read_snapshot(&path) {
            Ok(s) => s,
            Err(_) => return,
        };
        if !snap.exists {
            if !self.dirty && self.status != "⚠️ File rimosso su disco" {
                self.status = "⚠️ File rimosso su disco".into();
            }
            return;
        }
        // Read-only policy can change with identical content.
        if snap.read_only != self.read_only {
            self.read_only = snap.read_only;
            if snap.read_only {
                self.status = if self.dirty {
                    "🔒 Sola lettura — modifiche non salvate".into()
                } else {
                    "🔒 Sola lettura".into()
                };
            } else {
                self.refresh_status();
            }
        }
        if self.dirty {
            // In-progress edits win the screen; a differing revision is only
            // reported, like the web watchdog.
            if snap.revision != self.disk_revision
                && self.status != "⚠️ Cambiato su disco"
            {
                self.status = "⚠️ Cambiato su disco".into();
            }
            return;
        }
        if snap.revision == self.disk_revision {
            return;
        }
        if snap.content == self.text {
            // Same bytes on screen: just adopt the new baseline.
            self.disk_revision = snap.revision;
            return;
        }
        // External edit on a clean buffer: reload it, like the web watchdog.
        let caret = self.last_caret.min(snap.content.chars().count());
        self.text = snap.content;
        self.disk_revision = snap.revision;
        self.dirty = false;
        self.last_caret = caret;
        self.status = "● Ricaricato dal disco".into();
    }

    // ------------------------------------------------------------ saves

    pub fn mark_edited(&mut self) {
        self.dirty = true;
        self.last_edit = Some(Instant::now());
        self.status = if self.path.is_some() {
            "○ Modificato".into()
        } else {
            "○ Non salvato".into()
        };
    }

    fn refresh_status(&mut self) {
        if self.read_only {
            self.status = if self.dirty {
                "🔒 Sola lettura — modifiche non salvate".into()
            } else {
                "🔒 Sola lettura".into()
            };
        } else if self.dirty {
            self.status = if self.path.is_some() {
                "○ Modificato".into()
            } else {
                "○ Non salvato".into()
            };
        } else if !self.status.starts_with('●') {
            self.status = "● Salvato".into();
        }
    }

    fn autosave_now(&mut self) {
        self.do_save(false);
    }

    fn save_explicit(&mut self) {
        if self.read_only {
            self.status = "🔒 Sola lettura — usa Ctrl+Shift+S per salvare una copia".into();
            return;
        }
        if self.path.is_none() {
            self.prompt_save_as();
            return;
        }
        self.do_save(true);
    }

    fn do_save(&mut self, explicit: bool) {
        let Some(path) = self.path.clone() else { return };
        let expected = if self.disk_revision.is_empty() {
            None
        } else {
            Some(self.disk_revision.as_str())
        };
        let force = self.force_next;
        match doc::save(&path, &self.text, expected, force) {
            Ok(rev) => {
                self.disk_revision = rev;
                self.dirty = false;
                self.force_next = false;
                self.status = "● Salvato".into();
                doc::push_recent(&path);
            }
            Err(SaveError::ReadOnly(reason)) => {
                self.read_only = true;
                self.force_next = false;
                self.status = format!("🔒 Sola lettura ({reason})");
            }
            Err(SaveError::Conflict { .. }) => {
                self.force_next = true;
                if explicit {
                    self.status =
                        "⚠️ Cambiato su disco — ripremi Ctrl+S per sovrascrivere"
                            .into();
                } else {
                    self.status = "⚠️ Cambiato su disco".into();
                }
            }
            Err(SaveError::Missing) => {
                self.force_next = false;
                self.status = "⚠️ File rimosso su disco".into();
            }
            Err(SaveError::RevisionRequired) => {
                self.force_next = true;
                self.status = "⚠️ Revisione mancante — ripremi Ctrl+S".into();
            }
            Err(SaveError::Io(e)) => {
                self.force_next = false;
                self.status = format!("⚠️ Errore salvataggio: {e}");
            }
        }
    }

    fn prompt_save_as(&mut self) {
        let dialog = rfd::FileDialog::new()
            .set_title("Salva documento Markdown")
            .add_filter("Markdown", &["md", "markdown", "txt", "mdown", "mkd"]);
        let Some(picked) = dialog.save_file() else { return };
        let path = picked;
        // A new destination: the baseline protects an existing file from a
        // silent overwrite, and force covers the explicit consent.
        self.path = Some(path.clone());
        self.force_next = false;
        self.read_only = false;
        let expected = if self.disk_revision.is_empty() {
            None
        } else {
            Some(self.disk_revision.as_str())
        };
        match doc::save(&path, &self.text, expected, false) {
            Ok(rev) => {
                self.disk_revision = rev;
                self.dirty = false;
                self.status = "● Salvato".into();
                doc::push_recent(&path);
            }
            Err(SaveError::Conflict { .. }) | Err(SaveError::RevisionRequired) => {
                self.force_next = true;
                self.status =
                    "⚠️ Esiste già un file con questo nome — ripremi Ctrl+S per sostituirlo"
                        .into();
            }
            Err(SaveError::ReadOnly(reason)) => {
                self.status = format!("🔒 Destinazione in sola lettura ({reason})");
            }
            Err(SaveError::Missing) => {
                self.status = "⚠️ Il file è stato rimosso su disco".into();
            }
            Err(SaveError::Io(e)) => {
                self.status = format!("⚠️ Errore salvataggio: {e}");
            }
        }
    }

    // ------------------------------------------------------------ documents

    pub fn adopt_snapshot(&mut self, path: PathBuf, snap: &DiskSnapshot) {
        self.text = snap.content.clone();
        self.path = Some(path);
        self.disk_revision = snap.revision.clone();
        self.dirty = false;
        self.read_only = snap.read_only;
        self.last_caret = 0;
        self.jump_target = None;
        self.status = if snap.read_only {
            "🔒 Sola lettura".into()
        } else {
            "● Salvato".into()
        };
    }

    fn open_picked_file(&mut self, path: PathBuf) {
        match doc::read_snapshot(&path) {
            Ok(snap) if snap.exists => {
                doc::push_recent(&path);
                self.adopt_snapshot(path, &snap);
            }
            Ok(_) => {
                self.status = "⚠️ File non trovato".into();
            }
            Err(e) => {
                self.status = format!("⚠️ Impossibile leggere: {e}");
            }
        }
    }

    fn new_document(&mut self) {
        self.text = String::new();
        self.path = None;
        self.disk_revision = String::new();
        self.dirty = false;
        self.read_only = false;
        self.last_caret = 0;
        self.status = "● Salvato".into();
    }

    // ------------------------------------------------------------ bars

    fn top_bar(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::top("hud").show(ctx, |ui| {
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                let name = self
                    .path
                    .as_ref()
                    .and_then(|p| p.file_name())
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "Senza titolo.md".to_string());
                ui.strong(&name);
                ui.separator();
                ui.label(&self.status);
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    egui::ComboBox::from_id_salt("theme")
                        .selected_text(self.theme.label())
                        .width(130.0)
                        .show_ui(ui, |ui| {
                            for t in Theme::ALL {
                                ui.selectable_value(&mut self.theme, t, t.label());
                            }
                        });
                    ui.separator();
                    ui.toggle_value(&mut self.typewriter, "⌨️ Typewriter");
                    if ui
                        .selectable_label(self.focus != FocusMode::Off, "🎯")
                        .clicked()
                    {
                        self.focus = self.focus.cycle();
                    }
                    ui.separator();
                    for (mode, key) in [
                        (ViewMode::Raw, "Ctrl+1"),
                        (ViewMode::Live, "Ctrl+2"),
                        (ViewMode::Split, "Ctrl+3"),
                    ] {
                        if ui
                            .selectable_label(self.view == mode, mode.label())
                            .on_hover_text(key)
                            .clicked()
                        {
                            self.view = mode;
                        }
                    }
                    ui.separator();
                    if ui.button("☰").clicked() {
                        self.outline_open = !self.outline_open;
                    }
                    if ui.button("📂 Apri").on_hover_text("Ctrl+O").clicked() {
                        self.confirm_discard = Some(ConfirmDiscard::Open);
                    }
                    if ui.button("💾 Salva").on_hover_text("Ctrl+S").clicked() {
                        self.save_explicit();
                    }
                });
            });
            ui.add_space(4.0);
        });
    }

    fn status_bar(&self, ctx: &egui::Context) {
        egui::TopBottomPanel::bottom("status").show(ctx, |ui| {
            ui.horizontal(|ui| {
                let (line, col) = line_col(&self.text, self.last_caret);
                ui.label(format!("Ln {line}, Col {col}"));
                ui.separator();
                let words = self.text.split_whitespace().count();
                ui.label(format!("{words} {}", if words == 1 { "parola" } else { "parole" }));
                ui.separator();
                let chars = self.text.chars().count();
                ui.label(format!("{chars} caratteri"));
                ui.separator();
                ui.label(self.focus.label());
                ui.separator();
                ui.label(if self.typewriter { "Typewriter: centrato" } else { "Typewriter: off" });
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let path = self
                        .path
                        .as_ref()
                        .map(|p| p.display().to_string())
                        .unwrap_or_else(|| "Senza titolo".into());
                    ui.label(path);
                });
            });
        });
    }

    fn outline_panel(&mut self, ctx: &egui::Context) {
        egui::SidePanel::left("outline")
            .default_width(230.0)
            .min_width(180.0)
            .frame(egui::Frame::NONE.inner_margin(egui::Margin::same(8)))
            .show(ctx, |ui| {
                ui.heading("Outline");
                ui.separator();
                let items = markdown::headings(&self.text);
                if items.is_empty() {
                    ui.label(
                        egui::RichText::new("Nessun titolo trovato.\nUsa # Titolo o ## Sottotitolo")
                            .weak(),
                    );
                    return;
                }
                egui::ScrollArea::vertical()
                    .id_salt("outline-scroll")
                    .auto_shrink([false, false])
                    .show(ui, |ui| {
                        for h in items {
                            let indent = (h.level.saturating_sub(1)) as f32 * 14.0;
                            ui.add_space(1.0);
                            ui.horizontal(|ui| {
                                ui.add_space(indent);
                                if ui
                                    .selectable_label(false, format!("{}", h.text))
                                    .clicked()
                                {
                                    // Jump the caret to the heading source line.
                                    let byte_off = h.byte_offset;
                                    let caret = char_index_at_byte(&self.text, byte_off);
                                    self.jump_target = Some(caret);
                                    self.outline_open = false;
                                }
                            });
                        }
                    });
            });
    }

    fn confirm_dialog(&mut self, ctx: &egui::Context) {
        let Some(pending) = self.confirm_discard else { return };
        let title = match pending {
            ConfirmDiscard::New => "Creare un nuovo documento?",
            ConfirmDiscard::Open => "Aprire un altro file?",
        };
        egui::Window::new("Modifiche non salvate")
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
            .show(ctx, |ui| {
                ui.label(format!("{title}\nIl documento attivo ha modifiche non salvate."));
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    if ui.button("Annulla").clicked() {
                        self.confirm_discard = None;
                    }
                    if ui.button("Procedi (perdi le modifiche)").clicked() {
                        self.confirm_discard = None;
                        match pending {
                            ConfirmDiscard::New => self.new_document(),
                            ConfirmDiscard::Open => {
                                if let Some(picked) = pick_open_file() {
                                    self.open_picked_file(picked);
                                }
                            }
                        }
                    }
                });
            });
    }

    // ------------------------------------------------------------ editor

    fn editor_pane(&mut self, ui: &mut egui::Ui) {
        // An outline click moves the caret programmatically, before the editor
        // renders, so this frame already shows (and scrolls to) the target.
        if let Some(caret) = self.jump_target.take() {
            let id = egui::Id::new(EDITOR_ID);
            if let Some(mut state) = TextEditState::load(ui.ctx(), id) {
                state
                    .cursor
                    .set_char_range(Some(CCursorRange::one(CCursor { index: caret, prefer_next_row: false })));
                state.store(ui.ctx(), id);
            }
            self.last_caret = caret;
        }

        let focus_mode = self.focus;
        let ink = ui.style().visuals.text_color();
        let dim = ink.gamma_multiply(0.30);
        let caret_for_layout = self.last_caret;
        let interactive = !self.read_only;

        egui::ScrollArea::vertical()
            .id_salt("editor-scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                let mut layouter = |ui: &egui::Ui,
                                    buffer: &dyn egui::TextBuffer,
                                    wrap: f32|
                 -> std::sync::Arc<egui::Galley> {
                    let text = buffer.as_str().to_string();
                    let mut job = egui::text::LayoutJob::default();
                    job.wrap.max_width = wrap;
                    let font = egui::TextStyle::Monospace.resolve(ui.style());

                    if focus_mode == FocusMode::Off {
                        job.append(
                            &text,
                            0.0,
                            egui::TextFormat::simple(font, ink),
                        );
                    } else {
                        // Byte ranges of the (start, end) focus range.
                        let chars: Vec<(usize, char)> =
                            text.char_indices().collect();
                        let total = chars.len();
                        let (cs, ce) = focus::focus_range(
                            focus_mode,
                            &text,
                            caret_for_layout.min(total),
                        );
                        let byte_start = if cs < total {
                            chars[cs].0
                        } else {
                            text.len()
                        };
                        let byte_end = if ce < total { chars[ce].0 } else { text.len() };
                        job.append(
                            &text[..byte_start],
                            0.0,
                            egui::TextFormat::simple(font.clone(), dim),
                        );
                        job.append(
                            &text[byte_start..byte_end],
                            0.0,
                            egui::TextFormat::simple(font.clone(), ink),
                        );
                        job.append(
                            &text[byte_end..],
                            0.0,
                            egui::TextFormat::simple(font, dim),
                        );
                    }
                    ui.fonts(|f| f.layout_job(job))
                };

                let output = egui::TextEdit::multiline(&mut self.text)
                    .id(egui::Id::new(EDITOR_ID))
                    .font(egui::TextStyle::Monospace)
                    .desired_width(f32::INFINITY)
                    .frame(false)
                    .margin(egui::Margin::symmetric(0, 2))
                    .interactive(interactive)
                    .layouter(&mut layouter)
                    .show(ui);

                if output.response.changed() {
                    self.mark_edited();
                }

                if let Some(range) = &output.cursor_range {
                    let caret = range.primary.index;
                    if caret != self.last_caret {
                        // Typewriter recentring, but never while the pointer
                        // drives the caret: the text must not move under a
                        // double click selection (the web app learned this the
                        // hard way — native word selection is free here, but
                        // the scroll rule is the same).
                        let pointer_frame = output.response.dragged()
                            || output.response.clicked()
                            || output.response.double_clicked()
                            || output.response.triple_clicked();
                        self.last_caret = caret;
                        if self.typewriter && !pointer_frame {
                            let galley = output.galley.clone();
                            let caret_rect = galley
                                .pos_from_cursor(CCursor { index: caret, prefer_next_row: false })
                                .translate(output.galley_pos.to_vec2());
                            // 45vh in the web app: centre the caret rect on a
                            // point 5% below the viewport centre.
                            let h = ui.max_rect().height();
                            let shifted = caret_rect.translate(egui::vec2(
                                0.0,
                                0.05 * h,
                            ));
                            ui.scroll_to_rect_animation(
                                shifted,
                                Some(egui::Align::Center),
                                if output.response.changed() {
                                    // typing: instant
                                    egui::style::ScrollAnimation::none()
                                } else {
                                    egui::style::ScrollAnimation::default()
                                },
                            );
                        }
                    }
                }
            });
    }

    fn preview_pane(&mut self, ui: &mut egui::Ui) {
        if self.text.trim().is_empty() {
            ui.label(
                egui::RichText::new("(documento vuoto)").weak(),
            );
            return;
        }
        egui::ScrollArea::vertical()
            .id_salt("preview-scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                ui.add_space(6.0);
                markdown::render_markdown(ui, &self.text);
            });
    }
}

impl eframe::App for RigoApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if self.theme != self.applied_theme {
            theme::apply(ctx, self.theme);
            self.applied_theme = self.theme;
        }
        self.render(ctx);
        // The editor and the watchdog wake the UI when they need it.
        ctx.request_repaint_after(Duration::from_millis(500));
    }
}

fn line_col(text: &str, caret: usize) -> (usize, usize) {
    let chars: Vec<char> = text.chars().collect();
    let caret = caret.min(chars.len());
    let mut line = 1;
    let mut last_nl = 0usize;
    for (i, c) in chars.iter().enumerate().take(caret) {
        if *c == '\n' {
            line += 1;
            last_nl = i + 1;
        }
    }
    (line, caret - last_nl + 1)
}

fn char_index_at_byte(text: &str, byte: usize) -> usize {
    text.char_indices().take_while(|(b, _)| *b < byte).count()
}


/// The native "Open" dialog (xdg-desktop-portal on Linux: no GTK build
/// dependency, works under GNOME/KDE/Fedora out of the box).
fn pick_open_file() -> Option<std::path::PathBuf> {
    rfd::FileDialog::new()
        .set_title("Apri documento Markdown")
        .add_filter("Markdown", &["md", "markdown", "txt", "mdown", "mkd"])
        .pick_file()
}

/// Test hooks: the same code paths the timers and shortcuts use, callable
/// headlessly without a display.
#[doc(hidden)]
impl RigoApp {
    /// The explicit save (Ctrl+S) path.
    pub fn save_for_tests(&mut self) {
        self.save_explicit();
    }

    /// The watchdog pass (forces the interval to have elapsed).
    pub fn watchdog_tick_for_tests(&mut self) {
        if let Some(earlier) = Instant::now().checked_sub(WATCH_INTERVAL) {
            self.last_watch = earlier;
        }
        self.watch_tick();
    }

    /// The Ctrl+N shortcut behaviour for a clean/dirty buffer.
    pub fn handle_shortcut_new_for_tests(&mut self) {
        if self.dirty {
            self.confirm_discard = Some(ConfirmDiscard::New);
        } else {
            self.new_document();
        }
    }
}

#[doc(hidden)]
pub fn line_col_for_tests(text: &str, caret: usize) -> (usize, usize) {
    line_col(text, caret)
}

fn welcome_markdown() -> String {
    "# Benvenuto in Rigo (nativo) ✍️\n\n\
     Un editor Markdown locale, semplice e senza distrazioni.\n\n\
     - **Ctrl+1 / Ctrl+2 / Ctrl+3**: Focus raw / Live preview / Dual split\n\
     - **Ctrl+D**: focus frase/paragrafo\n\
     - **Ctrl+O**: apri un file\n\
     - **Ctrl+S** / **Ctrl+Shift+S**: salva / salva con nome\n\n\
     *Cancella questo testo o apri un tuo documento.*\n"
        .to_string()
}
