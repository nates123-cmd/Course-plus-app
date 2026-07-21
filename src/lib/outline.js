// Markdown list-line parser, shared by the renderers that group flat lines back
// into nested lists (kit.jsx Markish).
//
// This used to also hold a hand-written outliner keymap for the markdown-source
// editor — Tab/Shift+Tab/Enter, indent targeting, ordered-list renumbering. All
// of that is gone: the editor is TipTap now (see components/MdEditor.jsx) and
// ProseMirror's ListItem provides the same behavior natively. Only the parser
// survives, because the read-only renderers still work on raw markdown text.

const INDENT = '  ' // two spaces = one level

// indent · (bullet | number + delimiter) · gap · body
const LIST = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))(?:([ \t]+)(.*))?$/
const CHECK = /^\[([ xX])\]\s+/ // "[ ] " / "[x] " task marker inside the body

export const indentWidth = (s) => s.match(/^[ \t]*/)[0].replace(/\t/g, INDENT).length

// Parse one line as a list item, or null if it isn't one. `offset` is the
// CommonMark content column — the indent a child item has to reach to nest.
// For "- foo" that's 2; for "200. foo" it's 5.
export function parseLine(line) {
  const m = LIST.exec(line)
  if (!m) return null
  const gap = m[5] || ' '
  const body = m[6] || ''
  const marker = m[2] || m[3] + m[4]
  const w = m[1].replace(/\t/g, INDENT).length
  return {
    w, indent: ' '.repeat(w), marker, gap, body,
    bullet: m[2] || '', ordered: !!m[3], delim: m[4] || '',
    num: m[3] ? parseInt(m[3], 10) : null,
    check: CHECK.test(body),
    offset: w + marker.length + gap.length,
  }
}
