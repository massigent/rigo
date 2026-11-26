//! Markdown rendering for the preview pane: pulldown-cmark events mapped to
//! egui widgets. A deliberate subset of GFM for the native prototype:
//! headings, paragraphs, inline bold/italic/code, links (rendered, not
//! opened), code blocks, block quotes, ordered/unordered/task lists and
//! horizontal rules. Raw HTML is rendered as literal text (the sanitizer of
//! the web app is not needed: nothing here is ever executed).

use eframe::egui;

use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};

/// A heading for the outline panel, with the byte offset of its source line
/// start (for a future click-to-jump).
#[derive(Clone, Debug)]
pub struct Heading {
    pub level: u8,
    pub text: String,
    pub byte_offset: usize,
}

/// Headings via the real parser, so fake headings inside code fences are not
/// listed (same property as the web outline).
pub fn headings(markdown: &str) -> Vec<Heading> {
    let mut out = Vec::new();
    let parser = Parser::new_ext(markdown, Options::empty()).into_offset_iter();
    // Index into `out` of the heading currently being collected, if any.
    let mut open: Option<usize> = None;
    for (event, range) in parser {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                out.push(Heading {
                    level: heading_level(level),
                    text: String::new(),
                    byte_offset: range.start,
                });
                open = Some(out.len() - 1);
            }
            Event::End(TagEnd::Heading(_)) => open = None,
            Event::Text(t) => {
                if let Some(h) = open.map(|i| &mut out[i]) {
                    if h.text.is_empty() {
                        h.text = t.into_string();
                    }
                }
            }
            Event::Code(t) | Event::InlineMath(t) => {
                if let Some(h) = open.map(|i| &mut out[i]) {
                    if h.text.is_empty() {
                        h.text = t.into_string();
                    }
                }
            }
            _ => {}
        }
    }
    out.retain(|h| !h.text.is_empty());
    out
}
fn heading_level(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

/// Render the whole document into `ui`.
pub fn render_markdown(ui: &mut egui::Ui, markdown: &str) {
    let parser = Parser::new_ext(
        markdown,
        Options::ENABLE_TASKLISTS | Options::ENABLE_STRIKETHROUGH,
    );
    let mut state = RenderState::default();
    for event in parser {
        handle_event(ui, &mut state, event);
    }
    flush_inline(ui, &mut state); // trailing text without a closing paragraph
}

#[derive(Default)]
struct RenderState {
    /// Inline text accumulated for the current block, with formats.
    inline: Vec<(String, InlineFormat)>,
    /// Format of the text currently being pushed.
    active_format: Option<InlineFormat>,
    /// True inside a code block: text is accumulated verbatim.
    code: Option<String>,
    /// Heading level being rendered, if any.
    heading: Option<u8>,
    block_quote: u32,
    list_stack: Vec<ListInfo>,
    table_mode: bool,
}

#[derive(Clone, Copy, Default, PartialEq)]
struct InlineFormat {
    bold: bool,
    italic: bool,
    code: bool,
    strikethrough: bool,
    link: bool,
}

struct ListInfo {
    ordered: bool,
    /// 1-based index of the current item, for ordered lists.
    item: usize,
    task: Option<bool>,
}

fn handle_event(ui: &mut egui::Ui, state: &mut RenderState, event: Event) {
    match event {
        Event::Start(tag) => start_tag(ui, state, tag),
        Event::End(tag) => end_tag(ui, state, tag),
        Event::Text(t) => {
            if let Some(code) = state.code.as_mut() {
                code.push_str(&t);
            } else if state.table_mode {
                // Table cells render as inline text separated by " | ".
                push_inline(state, t.into_string());
            } else {
                push_inline(state, t.into_string());
            }
        }
        Event::Code(t) => {
            let mut fmt = current_format(state);
            fmt.code = true;
            state.inline.push((t.into_string(), fmt));
        }
        Event::SoftBreak | Event::HardBreak => {
            push_inline(state, " ".into());
        }
        Event::Rule => {
            flush_inline(ui, state);
            ui.add(egui::Separator::default().horizontal());
        }
        Event::TaskListMarker(checked) => {
            if let Some(list) = state.list_stack.last_mut() {
                list.task = Some(checked);
            }
        }
        Event::Html(h) => {
            // Rendered as literal text: never interpreted, never executed.
            push_inline(state, h.into_string());
        }
        Event::InlineMath(m) => {
            let mut fmt = current_format(state);
            fmt.italic = true;
            state.inline.push((m.into_string(), fmt));
        }
        Event::DisplayMath(m) => {
            flush_inline(ui, state);
            let job = job_from_pairs(ui, &[(m.into_string(), InlineFormat { code: true, ..Default::default() })]);
            ui.add(egui::Label::new(job).wrap());
        }
        _ => {}
    }
}

fn start_tag(ui: &mut egui::Ui, state: &mut RenderState, tag: Tag) {
    match tag {
        Tag::Paragraph => {}
        Tag::Heading { level, .. } => {
            flush_inline(ui, state);
            state.inline.clear();
            let level = heading_level(level);
            state.heading = Some(level);
        }
        Tag::BlockQuote(_) => {
            flush_inline(ui, state);
            state.block_quote += 1;
        }
        Tag::CodeBlock(kind) => {
            flush_inline(ui, state);
            let mut code = String::new();
            if let CodeBlockKind::Fenced(info) = kind {
                if !info.is_empty() {
                    code.push_str(&format!("// {info}\n"));
                }
            }
            state.code = Some(code);
        }
        Tag::List(start) => {
            flush_inline(ui, state);
            state.list_stack.push(ListInfo {
                ordered: start.is_some(),
                item: start.unwrap_or(0).max(1) as usize,
                task: None,
            });
        }
        Tag::Item => {}
        Tag::Emphasis => with_format(state, |f| f.italic = true),
        Tag::Strong => with_format(state, |f| f.bold = true),
        Tag::Strikethrough => with_format(state, |f| f.strikethrough = true),
        Tag::Link { .. } => with_format(state, |f| f.link = true),
        Tag::Table(_) | Tag::TableHead | Tag::TableRow | Tag::TableCell => {
            state.table_mode = true;
        }
        _ => {}
    }
}

fn end_tag(ui: &mut egui::Ui, state: &mut RenderState, tag: TagEnd) {
    match tag {
        TagEnd::Paragraph => flush_inline(ui, state),
        TagEnd::Heading(_) => {
            flush_inline(ui, state);
        }
        TagEnd::BlockQuote(_) => {
            flush_inline(ui, state);
            state.block_quote = state.block_quote.saturating_sub(1);
        }
        TagEnd::CodeBlock => {
            let code = state.code.take().unwrap_or_default();
            code_block(ui, state, &code);
        }
        TagEnd::List(_) => {
            flush_inline(ui, state);
            state.list_stack.pop();
        }
        TagEnd::Item => {
            flush_inline(ui, state);
            if let Some(list) = state.list_stack.last_mut() {
                list.item += 1;
                list.task = None;
            }
        }
        TagEnd::Emphasis
        | TagEnd::Strong
        | TagEnd::Strikethrough
        | TagEnd::Link => {
            with_format(state, |f| {
                match tag {
                    TagEnd::Emphasis => f.italic = false,
                    TagEnd::Strong => f.bold = false,
                    TagEnd::Strikethrough => f.strikethrough = false,
                    TagEnd::Link => f.link = false,
                    _ => {}
                }
            });
        }
        TagEnd::Table | TagEnd::TableHead | TagEnd::TableRow | TagEnd::TableCell => {
            if matches!(tag, TagEnd::TableRow | TagEnd::Table) {
                push_inline(state, "\n".into());
            }
            if matches!(tag, TagEnd::Table) {
                state.table_mode = false;
            }
        }
        _ => {}
    }
}

fn with_format(
    state: &mut RenderState,
    toggle: impl FnOnce(&mut InlineFormat),
) {
    let mut fmt = current_format(state);
    toggle(&mut fmt);
    state.active_format = Some(fmt);
}

fn current_format(state: &RenderState) -> InlineFormat {
    state.active_format.unwrap_or_default()
}

fn push_inline(state: &mut RenderState, text: String) {
    if text.is_empty() {
        return;
    }
    let fmt = current_format(state);
    // Merge with the previous run when the format did not change.
    if let Some((prev_text, prev_fmt)) = state.inline.last_mut() {
        if *prev_fmt == fmt {
            prev_text.push_str(&text);
            return;
        }
    }
    state.inline.push((text, fmt));
}

fn flush_inline(ui: &mut egui::Ui, state: &mut RenderState) {
    state.active_format = None;
    if state.inline.is_empty() {
        return;
    }
    let pairs = std::mem::take(&mut state.inline);

    // Headings render as a sized block and ignore list context.
    if let Some(level) = state.heading.take() {
        let job = job_heading(ui, &pairs, level);
        ui.add_space(6.0);
        ui.add(egui::Label::new(job).wrap());
        if level == 1 {
            ui.add(egui::Separator::default().horizontal());
        }
        return;
    }

    let list_ctx = state.list_stack.last().map(|l| (l.ordered, l.item, l.task));
    let indent = state.list_stack.len().saturating_sub(1) as f32 * 18.0;

    let quote = state.block_quote;
    let body = |ui: &mut egui::Ui| {
        let mut all: Vec<(String, InlineFormat)> = Vec::new();
        if let Some((ordered, item, task)) = list_ctx {
            let marker = match task {
                Some(true) => "☑ ".to_string(),
                Some(false) => "☐ ".to_string(),
                None => {
                    if ordered {
                        format!("{item}. ")
                    } else {
                        "• ".to_string()
                    }
                }
            };
            all.push((marker, InlineFormat::default()));
        }
        all.extend(pairs.iter().cloned());
        let job = job_from_pairs(ui, &all);
        ui.add(egui::Label::new(job).wrap());
    };

    if quote > 0 {
        egui::Frame::NONE
            .inner_margin(egui::Margin::symmetric(10, 2))
            .show(ui, |ui| {
                let rect = ui.max_rect();
                ui.painter().vline(
                    rect.left() + 2.0,
                    egui::Rangef::new(rect.top() + 2.0, rect.bottom() - 2.0),
                    egui::Stroke::new(2.0_f32, ui.style().visuals.weak_text_color()),
                );
                ui.horizontal_wrapped(|ui| body(ui));
            });
    } else if state.list_stack.is_empty() {
        ui.horizontal_wrapped(|ui| body(ui));
    } else {
        ui.horizontal(|ui| {
            ui.add_space(indent);
            ui.horizontal_wrapped(|ui| body(ui));
        });
    }
}

fn job_from_pairs(ui: &mut egui::Ui, pairs: &[(String, InlineFormat)]) -> egui::text::LayoutJob {
    let mut job = egui::text::LayoutJob::default();
    let visuals = ui.style().visuals.clone();
    let base = egui::TextStyle::Body.resolve(ui.style());
    let mono = egui::TextStyle::Monospace.resolve(ui.style());
    for (text, fmt) in pairs {
        let mut format = egui::TextFormat {
            font_id: if fmt.code { mono.clone() } else { base.clone() },
            color: visuals.text_color(),
            ..Default::default()
        };
        if fmt.code {
            format.color = visuals.strong_text_color();
            format.background = visuals.code_bg_color;
        }
        if fmt.bold {
            format.font_id.size *= 1.0;
            format.font_id = egui::FontId::new(
                format.font_id.size,
                if fmt.code {
                    egui::FontFamily::Monospace
                } else {
                    egui::FontFamily::Proportional
                },
            );
            format.color = visuals.strong_text_color();
        }
        if fmt.italic {
            format.italics = true;
        }
        if fmt.strikethrough {
            format.strikethrough = egui::Stroke::new(1.0_f32, visuals.text_color());
        }
        if fmt.link {
            format.underline = egui::Stroke::new(1.0_f32, visuals.hyperlink_color);
            format.color = visuals.hyperlink_color;
        }
        job.append(text, 0.0, format);
    }
    job
}

fn job_heading(
    ui: &mut egui::Ui,
    pairs: &[(String, InlineFormat)],
    level: u8,
) -> egui::text::LayoutJob {
    let mut job = job_from_pairs(ui, pairs);
    let scale = match level {
        1 => 1.90,
        2 => 1.55,
        3 => 1.30,
        4 => 1.15,
        _ => 1.05,
    };
    for section in job.sections.iter_mut() {
        section.format.font_id.size *= scale;
        section.format.color = ui.style().visuals.strong_text_color();
    }
    job
}

fn code_block(ui: &mut egui::Ui, _state: &mut RenderState, code: &str) {
    egui::Frame::group(ui.style())
        .fill(ui.style().visuals.code_bg_color)
        .inner_margin(egui::Margin::same(10))
        .outer_margin(egui::Margin::symmetric(0, 4))
        .show(ui, |ui| {
            let mut layout = egui::text::LayoutJob::default();
            let font = egui::TextStyle::Monospace.resolve(ui.style());
            let mut fmt = egui::TextFormat::simple(font, ui.style().visuals.text_color());
            fmt.color = ui.style().visuals.strong_text_color();
            layout.append(code, 0.0, fmt);
            ui.add(
                egui::Label::new(layout)
                    .selectable(true)
                    .wrap(),
            );
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outline_skips_headings_inside_code_fences() {
        let md = "# Real\n\n```md\n# Fake\n```\n\n## Also real";
        let hs = headings(md);
        let titles: Vec<(u8, &str)> =
            hs.iter().map(|h| (h.level, h.text.as_str())).collect();
        assert_eq!(
            titles,
            vec![(1, "Real"), (2, "Also real")]
        );
    }

    #[test]
    fn outline_levels_and_text() {
        let md = "# Titolo\nparagrafo\n## Sotto\n### Profondo";
        let hs = headings(md);
        assert_eq!(hs.len(), 3);
        assert_eq!(hs[0].text, "Titolo");
        assert_eq!(hs[1].level, 2);
        assert_eq!(hs[2].text, "Profondo");
    }
}
