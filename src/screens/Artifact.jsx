// Full-page artifact viewer — opens a saved artifact (manual raw file, a Claude
// deliverable, or an "Update doc" edit guide). Raw 'file' artifacts render as
// monospace pre (verbatim); Claude-composed ones render formatted via Markish.
import { useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, Btn, IconBtn, Card, Label, Markish } from '../kit'
import { deleteArtifact } from '../lib/db'

const ART_KIND = {
  'update-guide': { icon: 'file-diff', label: 'Edit guide' },
  file: { icon: 'file-text', label: 'File' },
  onepager: { icon: 'file-text', label: 'One-pager' },
  exec: { icon: 'clipboard-text', label: 'Exec summary' },
  email: { icon: 'mail', label: 'Email draft' },
  deck: { icon: 'layout-board', label: 'Deck outline' },
}

export function ArtifactScreen() {
  const { t, f, go, route, isMobile } = useApp()
  const { artifactById, projectById, reload } = useData()
  const [copied, setCopied] = useState(false)
  const a = artifactById(route.id)

  if (!a) return <div style={{ padding: 40, fontFamily: f.body, color: t.t3 }}>Artifact not found.</div>
  const proj = a.project ? projectById(a.project) : null
  const kind = ART_KIND[a.artType] || { icon: 'file-export', label: 'Artifact' }
  const isFile = a.artType === 'file'
  const when = a.at ? new Date(a.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null

  const copy = () => { try { navigator.clipboard.writeText(a.body || '') } catch {} setCopied(true); setTimeout(() => setCopied(false), 1800) }
  const del = async () => {
    if (!window.confirm(`Delete “${a.title || 'this artifact'}”? This can’t be undone.`)) return
    try { await deleteArtifact(a.id); await reload(); go(proj ? { screen: 'project', id: a.project } : { screen: 'overview' }) }
    catch (e) { window.alert('Could not delete: ' + (e?.message || e)) }
  }

  return <div style={{ maxWidth: 840, margin: '0 auto', padding: isMobile ? '26px 18px 90px' : '30px 36px 90px' }}>
    <div onClick={() => go(proj ? { screen: 'project', id: a.project } : { screen: 'overview' })}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: 12.5, color: t.t3, cursor: 'pointer', marginBottom: 16 }}
      onMouseEnter={(e) => e.currentTarget.style.color = t.t1} onMouseLeave={(e) => e.currentTarget.style.color = t.t3}>
      <Icon n="chevron-left" s={15} />{proj ? proj.name : 'Work'}</div>

    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <Icon n={kind.icon} s={22} c={t.accent} style={{ marginTop: 4 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ margin: 0, fontFamily: f.title, fontSize: 26, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1, lineHeight: 1.15, textWrap: 'pretty' }}>{a.title}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontFamily: f.ui, fontSize: 12, color: t.t3, flexWrap: 'wrap' }}>
          <Label style={{ margin: 0 }}>{kind.label}</Label>
          {a.provenance && <span>· {a.provenance}</span>}
          {when && <span>· {when}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
        <Btn kind="outline" size="sm" icon={copied ? 'check' : 'copy'} onClick={copy}>{copied ? 'Copied' : 'Copy'}</Btn>
        <IconBtn n="trash" s={17} title="Delete" onClick={del} />
      </div>
    </div>

    <div style={{ marginTop: 22 }}>
      {isFile
        ? <pre className="selectable" style={{ margin: 0, overflow: 'auto', background: t.card, border: '1px solid ' + t.line, borderRadius: 12,
            padding: '16px 18px', fontFamily: 'ui-monospace, monospace', fontSize: 13, lineHeight: 1.6, color: t.t1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{a.body || '(empty)'}</pre>
        : <Card style={{ padding: '20px 22px' }} className="selectable"><Markish text={a.body || ''} /></Card>}
    </div>
  </div>
}
