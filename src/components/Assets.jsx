// Assets UI — file picker + drag/drop uploader and a list of hosted files.
// Images render inline via a signed URL, PDFs link/embed, and each asset shows a
// collapsible view of the markdown Claude extracted (the "interpret once" result)
// with a status pill + re-extract. Mount with a { projectId } or { noteId } scope.
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, Btn, Card, Label, Markish } from '../kit'
import { uploadAsset, deleteAsset, reExtract, signedUrl } from '../lib/assets'

const fmtSize = (b) => (b == null ? '' : b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB')

// ── status pill ──────────────────────────────────────────────────
function StatusPill({ status }) {
  const { t, f } = useApp()
  const skin = {
    pending: { icon: 'loader-2', label: 'Interpreting…', c: t.accent, bg: t.accentBg, line: t.accentLine },
    done:    { icon: 'sparkles', label: 'Interpreted', c: t.good, bg: t.sel, line: 'transparent' },
    error:   { icon: 'alert-triangle', label: 'Extract failed', c: t.risk, bg: t.riskBg, line: t.riskLine },
    skipped: { icon: 'minus', label: 'Not interpreted', c: t.t3, bg: t.sel, line: 'transparent' },
  }[status] || { icon: 'circle', label: status, c: t.t3, bg: t.sel, line: 'transparent' }
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: f.ui, fontSize: 11,
    fontWeight: 600, color: skin.c, background: skin.bg, border: '1px solid ' + skin.line, borderRadius: 7, padding: '2px 8px' }}>
    <Icon n={skin.icon} s={12} />{skin.label}</span>
}

// ── one asset ────────────────────────────────────────────────────
function AssetRow({ asset, onChange }) {
  const { t, f } = useApp()
  const [url, setUrl] = useState(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    if (asset.kind === 'image' || asset.kind === 'pdf') {
      signedUrl(asset.storagePath).then((u) => { if (alive) setUrl(u) }).catch(() => {})
    }
    return () => { alive = false }
  }, [asset.storagePath, asset.kind])

  const remove = async () => {
    if (!window.confirm(`Delete “${asset.filename}”?`)) return
    setBusy(true)
    try { await deleteAsset(asset.id); await onChange() }
    catch (e) { window.alert('Could not delete: ' + (e?.message || e)) } finally { setBusy(false) }
  }
  const redo = async () => {
    setBusy(true)
    try { await reExtract(asset.id); await onChange() }
    catch (e) { window.alert('Could not re-extract: ' + (e?.message || e)) } finally { setBusy(false) }
  }

  return <Card style={{ padding: 0, overflow: 'hidden' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px' }}>
      <Icon n={asset.kind === 'image' ? 'photo' : asset.kind === 'pdf' ? 'file-type-pdf' : 'file'} s={18} c={t.accent} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: f.body, fontSize: 14, color: t.t1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.filename}</div>
        <div style={{ fontFamily: f.ui, fontSize: 11, color: t.t3, marginTop: 2 }}>{fmtSize(asset.sizeBytes)}{asset.mime ? ' · ' + asset.mime : ''}</div>
      </div>
      <StatusPill status={asset.extractStatus} />
      {url && <a href={url} target="_blank" rel="noreferrer" title="Open original"
        style={{ display: 'inline-flex', color: t.t3 }}><Icon n="external-link" s={16} /></a>}
      <span onClick={busy ? undefined : remove} title="Delete" style={{ display: 'inline-flex', cursor: busy ? 'default' : 'pointer', color: t.t3 }}>
        <Icon n={busy ? 'loader-2' : 'trash'} s={16} /></span>
    </div>

    {/* inline preview */}
    {asset.kind === 'image' && url && <div style={{ borderTop: '1px solid ' + t.line, background: t.bg, padding: 10 }}>
      <img src={url} alt={asset.filename} style={{ maxWidth: '100%', maxHeight: 360, borderRadius: 8, display: 'block', margin: '0 auto' }} /></div>}
    {asset.kind === 'pdf' && url && <div style={{ borderTop: '1px solid ' + t.line, background: t.bg }}>
      <iframe src={url} title={asset.filename} style={{ width: '100%', height: 420, border: 0 }} /></div>}

    {/* extracted markdown — collapsible */}
    {(asset.extractedMd || asset.extractStatus === 'error') && <div style={{ borderTop: '1px solid ' + t.line }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px',
        cursor: 'pointer', fontFamily: f.ui, fontSize: 12, color: t.t2 }}>
        <Icon n={open ? 'chevron-down' : 'chevron-right'} s={14} c={t.t3} />
        <Icon n="sparkles" s={13} c={t.accent} />Interpreted text
        <div style={{ flex: 1 }} />
        <span onClick={(e) => { e.stopPropagation(); if (!busy) redo() }} title="Re-interpret with Claude"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: f.ui, fontSize: 11.5, color: t.t2, cursor: 'pointer' }}>
          <Icon n={busy ? 'loader-2' : 'refresh'} s={13} />Re-extract</span>
      </div>
      {open && <div className="selectable" style={{ padding: '4px 16px 16px', maxHeight: 420, overflowY: 'auto' }}>
        {asset.extractedMd ? <Markish text={asset.extractedMd} />
          : <span style={{ fontFamily: f.ui, fontSize: 12.5, color: t.risk }}>Extraction failed — try re-extract.</span>}
      </div>}
    </div>}
  </Card>
}

// ── uploader + list ──────────────────────────────────────────────
export function Assets({ projectId = null, noteId = null }) {
  const { t, f } = useApp()
  const { reload, assetsForProject, assetsForNote } = useData()
  const rows = noteId ? assetsForNote(noteId) : assetsForProject(projectId)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState(null)
  const [err, setErr] = useState(null)
  const inputRef = useRef(null)

  const handleFiles = async (files) => {
    const list = Array.from(files || [])
    if (!list.length) return
    setBusy(true); setErr(null)
    try {
      for (const file of list) {
        setStage('uploading')
        await uploadAsset(file, { projectId, noteId, onProgress: setStage, onExtracted: () => reload() })
      }
      await reload()
    } catch (e) { setErr(String(e?.message || e)) }
    finally { setBusy(false); setStage(null) }
  }

  const onDrop = (e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files) }

  return <div>
    <div onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 16px', borderRadius: 12, cursor: 'pointer',
        border: '1.5px dashed ' + (drag ? t.accent : t.line2), background: drag ? t.accentBg : t.card, marginBottom: rows.length ? 12 : 0,
        transition: 'border-color .14s, background .14s' }}>
      <Icon n={busy ? 'loader-2' : 'upload'} s={18} c={t.accent} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: f.ui, fontSize: 13.5, fontWeight: 600, color: t.t1 }}>
          {busy ? (stage === 'extracting' ? 'Interpreting…' : 'Uploading…') : 'Add a file'}</div>
        <div style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, marginTop: 1 }}>
          Drop or click — screenshots & PDFs are read by Claude on upload (max 10MB)</div>
      </div>
      <input ref={inputRef} type="file" multiple accept="image/*,application/pdf" style={{ display: 'none' }}
        onChange={(e) => { handleFiles(e.target.files); e.target.value = '' }} />
    </div>

    {err && <div style={{ fontFamily: f.ui, fontSize: 12, color: t.risk, background: t.riskBg, border: '1px solid ' + t.riskLine,
      borderRadius: 9, padding: '8px 11px', marginBottom: 12 }}>{err}</div>}

    {rows.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((a) => <AssetRow key={a.id} asset={a} onChange={reload} />)}
    </div>}
  </div>
}
