// Rich-text editor for note bodies — TipTap (ProseMirror) behind the same
// contract the rest of the app already uses: a markdown string in, a markdown
// string out. Storage (cp_notes {md} blocks) is unchanged.
//
// This replaces a markdown-SOURCE editor, where "- foo" stayed literal text and
// list behavior had to be hand-written. TipTap gives the standard text-box
// behavior natively: typing "- " becomes a real bullet, Tab/Shift+Tab nest and
// un-nest (ListItem binds sinkListItem/liftListItem), and Enter on an empty
// item exits the list.
//
// Round-trip safety is the thing to be careful with here — Record.jsx autosaves
// every few seconds, so markdown -> doc -> markdown runs constantly over notes
// that contain wide GFM tables. Verified: tables, nested lists and custom
// ordered starts survive byte-identical, and every construct reaches a fixed
// point on the first pass, so repeated saves can't make a note drift.
import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { Markdown } from 'tiptap-markdown'
import { useApp } from '../ctx'
import { Icon } from '../kit'

// The serializer escapes "[", which would turn our [[wiki links]] into
// \[\[Title\]\] and break the note-link rendering. Nothing writes a literal
// \[\[, so undoing exactly that pair restores fidelity without touching real
// escapes.
const unescapeWiki = (s) => String(s || '').replace(/\\\[\\\[([^\]]+?)\\\]\\\]/g, '[[$1]]')

const EXTENSIONS = [
  StarterKit.configure({ link: { openOnClick: false } }),
  TableKit.configure({ table: { resizable: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Markdown.configure({ html: false, transformPastedText: true, breaks: false }),
]

function Tool({ icon, title, active, disabled, onClick }) {
  const { t } = useApp()
  return <button type="button" title={title} disabled={disabled}
    onMouseDown={(e) => { e.preventDefault(); onClick() }}
    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 28,
      borderRadius: 7, border: 0, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
      background: active ? t.accentBg : 'transparent', color: active ? t.accent : t.t2 }}>
    <Icon n={icon} s={15} />
  </button>
}

const Sep = () => { const { t } = useApp(); return <span style={{ width: 1, height: 18, background: t.line, margin: '0 3px' }} /> }

export default function MdEditorInner({ value, onChange, minHeight = 360 }) {
  const { mode, t, f } = useApp()
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  // What we last handed upward. The value prop echoes back through the parent's
  // state, and re-seeding the document on that echo would reset the cursor on
  // every keystroke — so only re-seed when the incoming value is genuinely
  // different from what this editor produced.
  const emitted = useRef(value || '')
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: value || '',
    editorProps: { attributes: { class: 'tt-content' } },
    onUpdate: ({ editor }) => {
      const md = unescapeWiki(editor.storage.markdown.getMarkdown())
      emitted.current = md
      onChangeRef.current(md)
    },
  })

  useEffect(() => {
    if (!editor) return
    const incoming = value || ''
    if (incoming === emitted.current) return
    emitted.current = incoming
    editor.commands.setContent(incoming, { emitUpdate: false })
  }, [editor, value])

  const applyLink = useCallback(() => {
    if (!editor) return
    const url = linkUrl.trim()
    if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    else editor.chain().focus().extendMarkRange('link').unsetLink().run()
    setLinkOpen(false); setLinkUrl('')
  }, [editor, linkUrl])

  if (!editor) return <div style={{ padding: 16, color: t.t3, fontFamily: f.ui, fontSize: 13 }}>Loading editor…</div>

  const is = (n, attrs) => editor.isActive(n, attrs)
  const cmd = (fn) => () => fn(editor.chain().focus()).run()

  return <div className={'tt-editor' + (mode === 'dark' ? ' tt-dark' : '')}
    style={{ border: '1px solid ' + t.line, borderRadius: 10, background: t.card, overflow: 'hidden' }}>
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, padding: '5px 7px',
      borderBottom: '1px solid ' + t.line, background: t.panel }}>
      <Tool icon="bold" title="Bold" active={is('bold')} onClick={cmd((c) => c.toggleBold())} />
      <Tool icon="italic" title="Italic" active={is('italic')} onClick={cmd((c) => c.toggleItalic())} />
      <Tool icon="strikethrough" title="Strikethrough" active={is('strike')} onClick={cmd((c) => c.toggleStrike())} />
      <Sep />
      <Tool icon="h-1" title="Heading 1" active={is('heading', { level: 1 })} onClick={cmd((c) => c.toggleHeading({ level: 1 }))} />
      <Tool icon="h-2" title="Heading 2" active={is('heading', { level: 2 })} onClick={cmd((c) => c.toggleHeading({ level: 2 }))} />
      <Tool icon="h-3" title="Heading 3" active={is('heading', { level: 3 })} onClick={cmd((c) => c.toggleHeading({ level: 3 }))} />
      <Sep />
      <Tool icon="list" title="Bullet list" active={is('bulletList')} onClick={cmd((c) => c.toggleBulletList())} />
      <Tool icon="list-numbers" title="Numbered list" active={is('orderedList')} onClick={cmd((c) => c.toggleOrderedList())} />
      <Tool icon="list-check" title="Checklist" active={is('taskList')} onClick={cmd((c) => c.toggleTaskList())} />
      <Tool icon="indent-increase" title="Indent (Tab)" onClick={() => editor.chain().focus().sinkListItem('listItem').run()} />
      <Tool icon="indent-decrease" title="Outdent (Shift+Tab)" onClick={() => editor.chain().focus().liftListItem('listItem').run()} />
      <Sep />
      <Tool icon="blockquote" title="Quote" active={is('blockquote')} onClick={cmd((c) => c.toggleBlockquote())} />
      <Tool icon="code" title="Code" active={is('codeBlock')} onClick={cmd((c) => c.toggleCodeBlock())} />
      <Tool icon="link" title="Link" active={is('link')} onClick={() => { setLinkUrl(editor.getAttributes('link').href || ''); setLinkOpen((o) => !o) }} />
      <Tool icon="table" title="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
      <Sep />
      <Tool icon="arrow-back-up" title="Undo" disabled={!editor.can().undo()} onClick={cmd((c) => c.undo())} />
      <Tool icon="arrow-forward-up" title="Redo" disabled={!editor.can().redo()} onClick={cmd((c) => c.redo())} />
    </div>

    {linkOpen && <div style={{ display: 'flex', gap: 7, padding: '7px 9px', borderBottom: '1px solid ' + t.line, background: t.panel }}>
      <input autoFocus value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink() } if (e.key === 'Escape') setLinkOpen(false) }}
        placeholder="https://… (empty removes the link)"
        style={{ flex: 1, border: '1px solid ' + t.line2, borderRadius: 7, background: t.bg, padding: '6px 9px',
          fontFamily: f.ui, fontSize: 13, color: t.t1, outline: 0 }} />
      <button type="button" onMouseDown={(e) => { e.preventDefault(); applyLink() }}
        style={{ border: 0, borderRadius: 7, background: t.accent, color: t.onAccent, padding: '6px 12px',
          fontFamily: f.ui, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Apply</button>
    </div>}

    <EditorContent editor={editor} style={{ minHeight, maxHeight: Math.max(minHeight, 520), overflowY: 'auto' }} />
  </div>
}
