// Markdown editor with a formatting toolbar (bold/italic/headings/lists/quote/
// code/table/link) — @uiw/react-md-editor, lazy-loaded so the heavy lib only
// ships when the user actually edits. Value is a markdown string.
//
// Tab / Shift+Tab / Enter are ours, not the library's: they run the outliner
// model in lib/outline.js so bullets and numbered items nest, outdent and
// continue the way they do in a real outliner. The library binds its own
// keydown listener directly on the textarea element, which fires before any
// React handler, so we intercept in the capture phase on the wrapper and stop
// the event there.
import { lazy, Suspense, useCallback, useEffect, useRef } from 'react'
import '@uiw/react-md-editor/markdown-editor.css'
import { useApp } from '../ctx'
import { handleTablePaste } from '../lib/tablePaste'
import { indentAt, enterAt, toOffset } from '../lib/outline'

const MDEditor = lazy(() => import('@uiw/react-md-editor'))

const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set

// Replace a range of the textarea, preferring execCommand so the browser's own
// undo stack survives. Both paths fire a real input event, which is what keeps
// the editor's internal state and our controlled value in sync.
function writeRange(ta, start, end, text, onChange) {
  ta.focus()
  ta.setSelectionRange(start, end)
  let ok = false
  try { ok = document.execCommand('insertText', false, text) } catch { ok = false }
  if (!ok) {
    const next = ta.value.slice(0, start) + text + ta.value.slice(end)
    nativeValue.call(ta, next)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    onChange(next)
  }
}

// The edited line always belongs in the replaced region, even when the diff
// scan alone wouldn't reach it (e.g. an Enter that only appends).
function caretLine(lines, caret) {
  let n = 0
  for (let i = 0; i < lines.length; i++) {
    const end = n + lines[i].length
    if (caret <= end) return i
    n = end + 1
  }
  return Math.max(0, lines.length - 1)
}

// Swap in a rewritten document, touching only the lines that actually changed
// so undo stays granular and the scroll position holds.
function applyLines(ta, lines, next, sel, onChange) {
  const i = caretLine(lines, ta.selectionStart)
  let a = 0
  while (a < lines.length && a < next.length && lines[a] === next[a]) a++
  let b = lines.length - 1
  let c = next.length - 1
  while (b >= a && c >= a && lines[b] === next[c]) { b--; c-- }
  a = Math.min(a, i)
  b = Math.max(b, i)
  c = b + (next.length - lines.length)
  if (c < a) return

  const start = toOffset(lines, { line: a, col: 0 })
  const end = toOffset(lines, { line: b, col: lines[b].length })
  writeRange(ta, start, end, next.slice(a, c + 1).join('\n'), onChange)
  ta.setSelectionRange(toOffset(next, sel[0]), toOffset(next, sel[1]))
}

export function MdEditor({ value, onChange, minHeight = 360 }) {
  const { mode, t, f } = useApp()
  const wrap = useRef(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  const onKeyCapture = useCallback((e) => {
    const ta = e.target
    if (!ta || ta.tagName !== 'TEXTAREA') return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const isTab = e.key === 'Tab'
    const isEnter = e.key === 'Enter' && !e.shiftKey && !e.isComposing
    if (!isTab && !isEnter) return

    // Past this point the library's handler must not see the event, whether or
    // not we rewrite anything — its list detection misfires on plain lines that
    // merely start with digits ("200 licenses" -> "201. ").
    e.stopPropagation()

    const lines = ta.value.split('\n')
    const res = isTab
      ? indentAt(lines, ta.selectionStart, ta.selectionEnd, e.shiftKey)
      : enterAt(lines, ta.selectionStart, ta.selectionEnd)

    if (res === 'plain') return // let the browser insert the newline itself
    e.preventDefault()
    if (!res) return // Tab with nowhere to go: swallowed, never moves focus
    applyLines(ta, lines, res.lines, res.sel, (v) => changeRef.current(v))
  }, [])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    el.addEventListener('keydown', onKeyCapture, true)
    return () => el.removeEventListener('keydown', onKeyCapture, true)
  }, [onKeyCapture])

  return <div ref={wrap} data-color-mode={mode === 'dark' ? 'dark' : 'light'} style={{ fontFamily: f.body }}>
    <Suspense fallback={<div style={{ padding: 16, color: t.t3, fontFamily: f.ui, fontSize: 13 }}>Loading editor…</div>}>
      <MDEditor
        value={value}
        onChange={(v) => onChange(v ?? '')}
        height={minHeight}
        preview="edit"
        visibleDragbar
        textareaProps={{
          placeholder: 'Write in markdown — toolbar above, or **bold**, # heading, - list, | tables |…',
          // Paste a table from Excel/Sheets/Word/web → real GFM markdown table
          onPaste: (e) => handleTablePaste(e, value || '', (v) => onChange(v)),
        }}
      />
    </Suspense>
  </div>
}
