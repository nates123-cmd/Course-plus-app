// Robust markdown renderer for the app — react-markdown + remark-gfm (GFM:
// tables, task lists, nested/indented lists, strikethrough, autolinks) with
// theme-token styling and the app's [[wiki links]] preserved (they become
// clickable, navigating to the note by title). Replaces the hand-rolled Markish
// for anything that may contain real markdown (notes, artifacts, AI answers).
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useApp } from '../ctx'
import { useData } from '../DataContext'

// Turn [[Title]] into a marker link the `a` renderer can intercept. Escapes the
// title into the href so titles with spaces survive.
const wikiToLinks = (s) => String(s || '').replace(/\[\[([^\]]+)\]\]/g, (_, title) => `[${title}](#wiki:${encodeURIComponent(title.trim())})`)

export function RichText({ text, style }) {
  const { t, f, go } = useApp()
  const { noteByTitle } = useData()
  const cell = { border: '1px solid ' + t.line2, padding: '7px 11px', fontFamily: f.body, fontSize: 14, lineHeight: 1.5, color: t.t1, textAlign: 'left', verticalAlign: 'top' }

  const components = {
    h1: ({ node, ...p }) => <div {...p} style={{ fontFamily: f.title, fontSize: 20, fontWeight: 700, letterSpacing: f.titleSpacing, color: t.t1, margin: '18px 0 8px' }} />,
    h2: ({ node, ...p }) => <div {...p} style={{ fontFamily: f.title, fontSize: 17, fontWeight: 700, letterSpacing: f.titleSpacing, color: t.t1, margin: '16px 0 7px' }} />,
    h3: ({ node, ...p }) => <div {...p} style={{ fontFamily: f.title, fontSize: 15, fontWeight: 700, color: t.t1, margin: '14px 0 6px' }} />,
    h4: ({ node, ...p }) => <div {...p} style={{ fontFamily: f.ui, fontSize: 13, fontWeight: 700, color: t.t2, margin: '12px 0 5px' }} />,
    p: ({ node, ...p }) => <p {...p} style={{ margin: '0 0 12px', fontFamily: f.body, fontSize: 15, lineHeight: 1.65, color: t.t1, textWrap: 'pretty' }} />,
    ul: ({ node, ordered, ...p }) => <ul {...p} style={{ margin: '0 0 12px', paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 5 }} />,
    ol: ({ node, ordered, ...p }) => <ol {...p} style={{ margin: '0 0 12px', paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 5 }} />,
    li: ({ node, ordered, checked, ...p }) => <li {...p} style={{ fontFamily: f.body, fontSize: 14.5, lineHeight: 1.55, color: t.t1 }} />,
    strong: ({ node, ...p }) => <strong {...p} style={{ fontWeight: 700, color: t.t1 }} />,
    em: ({ node, ...p }) => <em {...p} style={{ fontStyle: 'italic' }} />,
    del: ({ node, ...p }) => <del {...p} style={{ opacity: 0.6 }} />,
    blockquote: ({ node, ...p }) => <blockquote {...p} style={{ margin: '0 0 12px', padding: '4px 0 4px 14px', borderLeft: '3px solid ' + t.line2, color: t.t2, fontStyle: 'italic' }} />,
    code: ({ node, inline, ...p }) => inline
      ? <code {...p} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5, background: t.sel, borderRadius: 5, padding: '1px 5px', color: t.t1 }} />
      : <code {...p} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5, lineHeight: 1.55, color: t.t1 }} />,
    pre: ({ node, ...p }) => <pre {...p} style={{ margin: '0 0 12px', overflow: 'auto', background: t.card, border: '1px solid ' + t.line, borderRadius: 10, padding: '12px 14px' }} />,
    hr: () => <hr style={{ border: 0, borderTop: '1px solid ' + t.line, margin: '16px 0' }} />,
    table: ({ node, ...p }) => <div style={{ overflowX: 'auto', margin: '0 0 14px' }}><table {...p} style={{ borderCollapse: 'collapse', width: '100%' }} /></div>,
    th: ({ node, ...p }) => <th {...p} style={{ ...cell, fontFamily: f.ui, fontWeight: 700, fontSize: 12.5, background: t.sel, color: t.t2 }} />,
    td: ({ node, ...p }) => <td {...p} style={cell} />,
    a: ({ node, href, children, ...p }) => {
      if (href && href.startsWith('#wiki:')) {
        const title = decodeURIComponent(href.slice(6))
        const tgt = noteByTitle(title)
        return <span onClick={() => tgt && go({ screen: 'note', id: tgt.id })}
          style={{ color: t.accent, background: t.accentBg, border: '1px solid ' + t.accentLine, borderRadius: 7, padding: '1px 7px', cursor: tgt ? 'pointer' : 'default', fontSize: 13.5 }}>{children}</span>
      }
      return <a {...p} href={href} target="_blank" rel="noreferrer" style={{ color: t.accent, textDecoration: 'underline' }}>{children}</a>
    },
  }

  return <div className="selectable md-body" style={style}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{wikiToLinks(text)}</ReactMarkdown>
  </div>
}
