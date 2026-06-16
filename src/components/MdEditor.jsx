// Markdown editor with a formatting toolbar (bold/italic/headings/lists/quote/
// code/table/link, plus tab-indent) — @uiw/react-md-editor, lazy-loaded so the
// heavy lib only ships when the user actually edits. Value is a markdown string.
import { lazy, Suspense } from 'react'
import '@uiw/react-md-editor/markdown-editor.css'
import { useApp } from '../ctx'
import { handleTablePaste } from '../lib/tablePaste'

const MDEditor = lazy(() => import('@uiw/react-md-editor'))

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
          // Paste a table from Excel/Sheets/Word/web → real GFM markdown table
          onPaste: (e) => handleTablePaste(e, value || '', (v) => onChange(v)),
        }}
      />
    </Suspense>
  </div>
}
