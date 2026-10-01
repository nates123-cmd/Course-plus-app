// memo.jsx — pieces that only render in the 'memo' look (DESIGN.md). The classic
// look never mounts these, so deleting this file + the `look === 'memo'` branches
// is the whole undo.
import { useApp } from '../ctx'

export function isoWeek(d = new Date()) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = x.getUTCDay() || 7
  x.setUTCDate(x.getUTCDate() + 4 - day)
  return Math.ceil(((x - Date.UTC(x.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)
}

// One fill-in line of the Field Notes inside-cover form: "DATE: ________".
function MemoField({ label, children, dashed }) {
  const { f } = useApp()
  return <>
    <span style={{ fontFamily: f.label, fontSize: 10, fontWeight: 700, letterSpacing: f.labelSpacing, textTransform: 'uppercase',
      color: 'var(--kraftRule)', whiteSpace: 'nowrap', paddingBottom: 3 }}>{label}:</span>
    <span style={{ minWidth: 0, fontFamily: f.ui, fontSize: 15, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--kraftInk)',
      borderBottom: '1.5px ' + (dashed ? 'dashed' : 'solid') + ' var(--kraftRule)', paddingBottom: 2,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
  </>
}

// The kraft cover. `title` is the page ("Work"), `fields` the real values that
// fill the form's lines: [{ label, value, dashed }].
export function MemoCover({ title, fields }) {
  const { f } = useApp()
  return <div style={{ background: 'var(--kraft)', padding: '20px 22px' }}>
    <div style={{ fontFamily: f.label, fontSize: 13, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--kraftInk)' }}>
      Course+ &nbsp;·&nbsp; {title} &nbsp;·&nbsp; Wk {isoWeek()}</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px 14px', alignItems: 'end', marginTop: 16 }}>
      {fields.map((x) => <MemoField key={x.label} label={x.label} dashed={x.dashed}>{x.value}</MemoField>)}
    </div>
  </div>
}

// Section head: letterspaced caps over a solid ink rule.
export function MemoHead({ label, meta }) {
  const { t, f } = useApp()
  return <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, paddingBottom: 7, borderBottom: '1.5px solid ' + t.t1 }}>
    <span style={{ fontFamily: f.label, fontSize: 11.5, fontWeight: 700, letterSpacing: f.labelSpacing, textTransform: 'uppercase', color: t.t1, whiteSpace: 'nowrap' }}>{label}</span>
    {meta && <span style={{ fontFamily: f.ui, fontSize: 12, color: t.t3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta}</span>}
  </div>
}

// Linear's status circle mapped to Course+ task state: dashed = icebox,
// half = pulled into Now, quarter = waiting, filled = done.
export function StatusCircle({ state, c, s = 15 }) {
  const fill = state === 'now' ? 50 : state === 'waiting' ? 25 : state === 'done' ? 100 : 0
  return <span style={{ width: s, height: s, borderRadius: '50%', flex: 'none', zIndex: 1, position: 'relative', display: 'inline-block',
    border: '1.5px ' + (state === 'icebox' ? 'dashed' : 'solid') + ' ' + c }}>
    {fill > 0 && <span style={{ position: 'absolute', inset: fill === 100 ? 0 : 2, borderRadius: '50%',
      background: `conic-gradient(${c} 0 ${fill}%, transparent 0)` }} />}
  </span>
}
