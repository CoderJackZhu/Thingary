//! RFC 4180 tokenizer with physical positions. A record may span several
//! physical lines through quoted newlines; records carry the 1-based physical
//! line they start on, and format errors carry the exact line and character
//! column of the offending character. Blank records (every cell empty after
//! trimming) are dropped and never counted as data rows.
pub(super) struct RawRecord {
    /// 1-based physical line where the record starts.
    pub(super) start_line: usize,
    pub(super) cells: Vec<String>,
}

pub(super) struct FormatError {
    pub(super) record_start_line: usize,
    /// Physical line of the offending character (or of EOF).
    pub(super) line: usize,
    /// 1-based character column on that line.
    pub(super) column: usize,
    pub(super) reason: &'static str,
}

pub(super) enum TokenizeStop {
    /// More data records than the limit allows; nothing is truncated.
    OverLimit,
    Cancelled,
}

/// Tokenize `text` into at most `max_records` non-blank records. Returns the
/// records parsed before a fatal format error together with that error, so the
/// caller can still show a locatable issue instead of pretending the file was
/// empty.
pub(super) fn parse_records(
    text: &str,
    max_records: usize,
    cancel: &dyn Fn() -> bool,
) -> Result<(Vec<RawRecord>, Option<FormatError>), TokenizeStop> {
    let (mut records, mut row, mut cell) = (Vec::new(), Vec::new(), String::new());
    let (mut line, mut col) = (1usize, 1usize);
    let (mut quoted, mut quote_closed) = (false, false);
    let mut row_start_line = 1usize;
    let mut since_checkpoint = 0usize;
    let mut chars = text.chars().peekable();

    macro_rules! end_cell {
        () => {{
            row.push(std::mem::take(&mut cell));
            quoted = false;
            quote_closed = false;
        }};
    }
    macro_rules! end_record {
        () => {{
            row.push(std::mem::take(&mut cell));
            let (start, row_cells) = (row_start_line, std::mem::take(&mut row));
            row_start_line = line;
            if row_cells.iter().any(|v| !v.trim().is_empty()) {
                if records.len() >= max_records {
                    return Err(TokenizeStop::OverLimit);
                }
                records.push(RawRecord {
                    start_line: start,
                    cells: row_cells,
                });
                since_checkpoint += 1;
                if since_checkpoint >= 4096 {
                    since_checkpoint = 0;
                    if cancel() {
                        return Err(TokenizeStop::Cancelled);
                    }
                }
            }
            quoted = false;
            quote_closed = false;
        }};
    }

    while let Some(c) = chars.next() {
        let (cl, cc) = (line, col);
        if c == '\n' {
            line += 1;
            col = 1;
        } else {
            col += 1;
        }
        if quoted {
            match c {
                '"' => {
                    if chars.peek() == Some(&'"') {
                        chars.next();
                        col += 1;
                        cell.push('"');
                    } else {
                        quoted = false;
                        quote_closed = true;
                    }
                }
                _ => cell.push(c),
            }
        } else if quote_closed {
            match c {
                ',' => end_cell!(),
                '\n' => end_record!(),
                '\r' if chars.peek() == Some(&'\n') => {}
                _ => {
                    return Ok((
                        records,
                        Some(FormatError {
                            record_start_line: row_start_line,
                            line: cl,
                            column: cc,
                            reason: "引号字段结束后应紧跟逗号或换行，不能有其他字符",
                        }),
                    ))
                }
            }
        } else {
            match c {
                '"' if cell.is_empty() => quoted = true,
                '"' => {
                    return Ok((
                        records,
                        Some(FormatError {
                            record_start_line: row_start_line,
                            line: cl,
                            column: cc,
                            reason: "未加引号的字段中出现引号：如需引号，请把整个字段用引号包裹，并把内部引号写成两个连续引号",
                        }),
                    ))
                }
                ',' => end_cell!(),
                '\n' => end_record!(),
                '\r' if chars.peek() == Some(&'\n') => {}
                _ => cell.push(c),
            }
        }
    }
    let fatal = quoted.then_some(FormatError {
        record_start_line: row_start_line,
        line,
        column: col,
        reason: "文件结束处仍有未闭合的引号",
    });
    row.push(std::mem::take(&mut cell));
    let row_cells = std::mem::take(&mut row);
    if row_cells.iter().any(|v| !v.trim().is_empty()) {
        if records.len() >= max_records {
            return Err(TokenizeStop::OverLimit);
        }
        records.push(RawRecord {
            start_line: row_start_line,
            cells: row_cells,
        });
    }
    Ok((records, fatal))
}
