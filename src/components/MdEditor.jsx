// Note-body editor entry point. The real editor (TipTap + ProseMirror + the
// markdown bridge) is heavy and only needed once someone actually edits, so it
// stays in its own chunk behind a lazy import — same arrangement the previous
// editor had, keeping it out of the initial app load.
//
// Contract: markdown string in via `value`, markdown string out via `onChange`.
// See MdEditorInner.jsx for the editor itself.
import { lazy, Suspense } from 'react'
import { useApp } from '../ctx'

const Inner = lazy(() => import('./MdEditorInner'))

export function MdEditor({ value, onChange, minHeight = 360 }) {
  const { t, f } = useApp()
  return <Suspense fallback={
    <div style={{ minHeight, border: '1px solid ' + t.line, borderRadius: 10, background: t.card,
      padding: 16, color: t.t3, fontFamily: f.ui, fontSize: 13 }}>Loading editor…</div>
  }>
    <Inner value={value} onChange={onChange} minHeight={minHeight} />
  </Suspense>
}
