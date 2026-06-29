// Markdown editor with a formatting toolbar (bold/italic/headings/lists/quote/
// code/table/link, plus tab-indent) — @uiw/react-md-editor, lazy-loaded so the
// heavy lib only ships when the user actually edits. Value is a markdown string.
import { lazy, Suspense } from 'react'
import '@uiw/react-md-editor/markdown-editor.css'
import { useApp } from '../ctx'
import { handleTablePaste } from '../lib/tablePaste'

const MDEditor = lazy(() => import('@uiw/react-md-editor'))

const INDENT = '  ' // two spaces = one bullet level
const LIST_RE = /^(\s*)([-*+]|\d+\.)(\s)/ // bullet or numbered list item

// Tab on a list line indents the whole line (bullet marker included) so it
// becomes a sub-bullet — Google Docs / Word behavior — instead of just shoving
// the text right. Shift+Tab outdents. Non-list lines fall through to the
// editor's default tab handling.
function handleListIndent(e, onChange) {
  if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return
  const ta = e.target
  const val = ta.value
  const selStart = ta.selectionStart
  const selEnd = ta.selectionEnd

  const lineStart = val.lastIndexOf('\n', selStart - 1) + 1
  let blockEnd = val.indexOf('\n', selEnd)
  if (blockEnd === -1) blockEnd = val.length

  const block = val.slice(lineStart, blockEnd)
  const lines = block.split('\n')
  // Only hijack Tab when the first affected line is a list item.
  if (!LIST_RE.test(lines[0])) return
  e.preventDefault()

  let firstDelta = 0
  let totalDelta = 0
  const newLines = lines.map((ln, i) => {
    if (e.shiftKey) {
      const m = ln.match(/^( {1,2}|\t)/)
      const removed = m ? m[0].length : 0
      if (i === 0) firstDelta = -removed
      totalDelta -= removed
      return removed ? ln.slice(removed) : ln
    }
    if (i === 0) firstDelta = INDENT.length
    totalDelta += INDENT.length
    return INDENT + ln
  })

  const newVal = val.slice(0, lineStart) + newLines.join('\n') + val.slice(blockEnd)
  onChange(newVal)

  // Re-apply selection after React re-renders the controlled textarea.
  const ns = Math.max(lineStart, selStart + firstDelta)
  const ne = selEnd + totalDelta
  requestAnimationFrame(() => { ta.selectionStart = ns; ta.selectionEnd = ne })
}

export function MdEditor({ value, onChange, minHeight = 360 }) {
  const { mode, t, f } = useApp()
  return <div data-color-mode={mode === 'dark' ? 'dark' : 'light'} style={{ fontFamily: f.body }}>
    <Suspense fallback={<div style={{ padding: 16, color: t.t3, fontFamily: f.ui, fontSize: 13 }}>Loading editor…</div>}>
      <MDEditor
        value={value}
        onChange={(v) => onChange(v ?? '')}
        height={minHeight}
        preview="edit"
        visibleDragbar
        textareaProps={{
          placeholder: 'Write in markdown — toolbar above, or **bold**, # heading, - list, | tables |…',
          // Tab/Shift+Tab on bullets = sub-bullet indent/outdent (Docs/Word style)
          onKeyDown: (e) => handleListIndent(e, (v) => onChange(v)),
          // Paste a table from Excel/Sheets/Word/web → real GFM markdown table
          onPaste: (e) => handleTablePaste(e, value || '', (v) => onChange(v)),
        }}
      />
    </Suspense>
  </div>
}
