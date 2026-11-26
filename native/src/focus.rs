//! Focus ranges: the sentence/paragraph dimming logic, ported from
//! `web/static/js/focusdim.js`. Indices are CHAR indices (the editor works on
//! char cursors), so the whole implementation avoids byte slicing except via
//! the provided char vector.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FocusMode {
    Off,
    Sentence,
    Paragraph,
}

impl FocusMode {
    pub fn cycle(self) -> Self {
        match self {
            FocusMode::Off => FocusMode::Sentence,
            FocusMode::Sentence => FocusMode::Paragraph,
            FocusMode::Paragraph => FocusMode::Off,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            FocusMode::Off => "Focus: Spento",
            FocusMode::Sentence => "Focus: Frase",
            FocusMode::Paragraph => "Focus: Paragrafo",
        }
    }
}

/// The char range (start, end) that stays fully visible in the given mode.
/// `caret` is a char index, clamped to the text length.
pub fn focus_range(mode: FocusMode, text: &str, caret: usize) -> (usize, usize) {
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    if len == 0 {
        return (0, 0);
    }
    let caret = caret.min(len);

    if mode == FocusMode::Paragraph {
        return paragraph_range(&chars, caret);
    }
    if mode == FocusMode::Sentence {
        return sentence_range(&chars, caret);
    }
    (0, len)
}

fn paragraph_range(chars: &[char], caret: usize) -> (usize, usize) {
    let start = match last_blank_line_before(chars, caret) {
        Some(i) => i + 2,
        None => 0,
    };
    let end = match first_blank_line_at_or_after(chars, caret) {
        Some(i) => i,
        None => chars.len(),
    };
    (start.min(end), end.max(start))
}

/// Index of the first '\n' of the first "\n\n" whose first '\n' is at or after
/// `from`: the paragraph ends there.
fn first_blank_line_at_or_after(chars: &[char], from: usize) -> Option<usize> {
    let mut i = from;
    while i + 1 < chars.len() {
        if chars[i] == '\n' && chars[i + 1] == '\n' {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Index of the FIRST '\n' of the last "\n\n" entirely before `from`,
/// mirroring `lastIndexOf("\n\n")` of the JS engine (start = index + 2).
fn last_blank_line_before(chars: &[char], from: usize) -> Option<usize> {
    let mut i = from as isize - 1;
    while i >= 1 {
        if chars[i as usize] == '\n' && chars[i as usize - 1] == '\n' {
            return Some(i as usize - 1); // the FIRST newline of the pair
        }
        i -= 1;
    }
    None
}

fn sentence_range(chars: &[char], caret: usize) -> (usize, usize) {
    let (p_start, p_end) = paragraph_range(chars, caret);
    let para: String = chars[p_start..p_end].iter().collect();
    let rel = caret.saturating_sub(p_start);

    if para.trim().is_empty() {
        return (p_start, p_end);
    }

    // Same tokenizer as the JS engine: every sentence consumes its trailing
    // punctuation, the gap to the next sentence belongs to no match.
    let mut matches: Vec<(usize, usize)> = Vec::new();
    let pchars: Vec<char> = para.chars().collect();
    let mut i = 0usize;
    while i < pchars.len() {
        if pchars[i].is_whitespace() || pchars[i] == '\n' {
            i += 1;
            continue;
        }
        let start = i;
        while i < pchars.len()
            && pchars[i] != '.'
            && pchars[i] != '!'
            && pchars[i] != '?'
            && pchars[i] != '\n'
        {
            i += 1;
        }
        // Consume the punctuation run (and nothing else).
        while i < pchars.len()
            && (pchars[i] == '.'
                || pchars[i] == '!'
                || pchars[i] == '?')
        {
            i += 1;
        }
        matches.push((start, i));
    }

    if matches.is_empty() {
        return (p_start, p_end);
    }

    // Cursor before the first sentence: highlight the first one.
    if rel <= matches[0].0 {
        return (p_start, p_start + matches[0].1);
    }

    let is_last = |idx: usize| idx + 1 == matches.len();
    for (idx, (start, end)) in matches.iter().enumerate() {
        let next_start = if is_last(idx) {
            pchars.len()
        } else {
            matches[idx + 1].0
        };
        if rel >= *start && rel < next_start {
            let hi_end = if is_last(idx) {
                pchars.len()
            } else {
                *end
            };
            return (p_start + start, p_start + hi_end);
        }
    }

    let (start, _) = *matches.last().unwrap();
    (p_start + start, p_end)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chars(text: &str, byte_idx: usize) -> usize {
        text.char_indices()
            .take_while(|(b, _)| *b < byte_idx)
            .count()
    }

    #[test]
    fn paragraph_bounds() {
        let text = "one\ntwo\n\nthree\nfour\n\nfive";
        // caret inside the first paragraph
        let (s, e) = focus_range(
            FocusMode::Paragraph,
            text,
            chars(text, 4), // inside "one\ntwo"
        );
        assert_eq!(&text[s..e], "one\ntwo");

        let (s, e) = focus_range(
            FocusMode::Paragraph,
            text,
            chars(text, text.find("four").unwrap()),
        );
        assert_eq!(&text[s..e], "three\nfour");

        let (s, e) = focus_range(
            FocusMode::Paragraph,
            text,
            chars(text, text.find("five").unwrap()),
        );
        assert_eq!(&text[s..e], "five");
    }

    #[test]
    fn sentence_bounds() {
        let text = "Prima frase. Seconda frase! Terza? Ultima";
        // caret inside "Seconda"
        let (s, e) = focus_range(
            FocusMode::Sentence,
            text,
            chars(text, text.find("Seconda").unwrap() + 2),
        );
        assert_eq!(&text[s..e], "Seconda frase!");

        let (s, e) = focus_range(
            FocusMode::Sentence,
            text,
            chars(text, text.find("Ultima").unwrap()),
        );
        assert_eq!(&text[s..e], "Ultima");

        // caret on the leading space of the paragraph: first sentence.
        let (s, e) = focus_range(FocusMode::Sentence, text, 0);
        assert_eq!(&text[s..e], "Prima frase.");
    }

    #[test]
    fn sentence_stays_inside_its_paragraph() {
        let text = "solo qui.\n\ndopo il paragrafo.";
        let (s, e) = focus_range(
            FocusMode::Sentence,
            text,
            chars(text, text.find("solo").unwrap()),
        );
        assert_eq!(&text[s..e], "solo qui.");
    }

    #[test]
    fn off_covers_everything_and_empty_is_safe() {
        let text = "anything";
        assert_eq!(
            focus_range(FocusMode::Off, text, 3),
            (0, text.chars().count())
        );
        assert_eq!(focus_range(FocusMode::Sentence, "", 10), (0, 0));
        // A caret beyond the end is clamped, not a panic.
        let v: Vec<char> = "a. b.".chars().collect();
        let (s, e) = focus_range(FocusMode::Sentence, "a. b.", 999);
        let shown: String = v[s.min(e)..e.max(s)].iter().collect();
        assert_eq!(shown, "b.");
    }
}
