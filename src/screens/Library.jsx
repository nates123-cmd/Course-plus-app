// Library (Direction B) — every document across every project, with kind
// filter chips and an optional topic/tag filter. Reference uses isReference();
// Meetings = kind 'meeting'; Notes = note|knowledge|brainstorm; Artifacts =
// kind 'artifact'. A tag arriving via route.tag pre-filters and shows a
// removable pill. Rows link to the note viewer. Notes are already recency-sorted.
// No window.* — useApp() for theme/route/nav, useData() for the corpus.
import { Fragment, useState } from 'react'
import { useApp } from '../ctx'
import { useData } from '../DataContext'
import { Icon, Card, Tag, KindBadge, AreaDot, isReference } from '../kit'
import { TOPICS } from '../data'

const KINDS = [
  ['all', 'All'],
  ['meeting', 'Meetings'],
  ['note', 'Notes'],
  ['artifact', 'Artifacts'],
  ['reference', 'Reference'],
]

// Apply a kind chip to a note. 'note' folds knowledge + brainstorm in.
function matchesKind(n, kind) {
  if (kind === 'all') return true
  if (kind === 'reference') return isReference(n)
  if (kind === 'note') return n.kind === 'note' || n.kind === 'knowledge' || n.kind === 'brainstorm'
  return n.kind === kind // meeting | artifact
}

export function LibraryScreen() {
  const { t, f, go, route } = useApp()
  const { notes: NOTES, notesByTag, projectById, projectName, ALL_TAGS } = useData()
  const [kind, setKind] = useState('all')
  const [tag, setTag] = useState(route.tag || null)

  // Tag pre-filter uses the data helper when set; otherwise the full corpus.
  let rows = tag ? notesByTag(tag) : NOTES
  rows = rows.filter((n) => matchesKind(n, kind))

  // Topic chips: prefer the curated TOPICS, but surface any other live tags too.
  const topicTags = [...TOPICS, ...ALL_TAGS.filter((x) => !TOPICS.includes(x))]

  return (
    <div data-screen-label="Library" style={{ maxWidth: 980, margin: '0 auto', padding: '40px 36px 90px' }}>
      <div style={{ fontFamily: f.title, fontSize: 28, fontWeight: f.titleW, letterSpacing: f.titleSpacing, color: t.t1 }}>Library</div>
      <div style={{ fontFamily: f.ui, fontSize: 13.5, color: t.t2, marginTop: 5 }}>
        {NOTES.length} documents across every project.
      </div>

      {/* kind chips + active tag pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 20, flexWrap: 'wrap' }}>
        {KINDS.map(([id, label]) => (
          <span key={id} onClick={() => setKind(id)} style={{ fontFamily: f.ui, fontSize: 12.5,
            fontWeight: 600, color: kind === id ? t.t1 : t.t3, background: kind === id ? t.sel : 'transparent',
            borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>{label}</span>
        ))}
        {tag && (
          <span onClick={() => setTag(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
            fontFamily: f.ui, fontSize: 12, fontWeight: 600, color: t.accent, background: t.accentBg,
            border: '1px solid ' + t.accentLine, borderRadius: 7, padding: '4px 10px', marginLeft: 6, cursor: 'pointer' }}>
            #{tag}<Icon n="x" s={12} />
          </span>
        )}
      </div>

      {/* topic filter row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 14, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: f.label, fontSize: 10,
          fontWeight: 600, letterSpacing: f.labelSpacing, textTransform: 'uppercase', color: t.t3, marginRight: 2 }}>
          <Icon n="tag" s={13} c={t.t3} />Topics
        </span>
        {topicTags.map((tp) => (
          <Tag key={tp} active={tag === tp} onClick={() => setTag(tag === tp ? null : tp)}>{tp}</Tag>
        ))}
      </div>

      <Card style={{ padding: 0, overflow: 'hidden', marginTop: 18 }}>
        {rows.map((n, i) => {
          const proj = n.project ? projectById(n.project) : null
          const ref = isReference(n)
          return (
            <div key={n.id} onClick={() => go({ screen: 'note', id: n.id })}
              style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 18px',
                cursor: 'pointer', borderTop: i ? '1px solid ' + t.line : 'none' }}
              onMouseEnter={(e) => e.currentTarget.style.background = t.sel}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
              <KindBadge kind={n.kind} withLabel={false} s={16} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: f.body, fontSize: 14.5, fontWeight: 500, color: t.t1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 2, fontFamily: f.ui, fontSize: 11, color: t.t3 }}>
                  {proj && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <AreaDot areaId={proj.area} s={6} />{proj.name}
                    </span>
                  )}
                  {n.people && n.people.length > 0 && (
                    <Fragment>
                      <span style={{ opacity: 0.5 }}>·</span>
                      <span>{n.people.join(', ')}</span>
                    </Fragment>
                  )}
                </div>
              </div>

              {ref && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: f.ui,
                  fontSize: 10.5, fontWeight: 600, color: t.accent, background: t.accentBg,
                  border: '1px solid ' + t.accentLine, borderRadius: 6, padding: '1px 7px' }}>
                  <Icon n="bookmark" s={11} />Ref
                </span>
              )}

              <div style={{ display: 'flex', gap: 5 }}>
                {(n.tags || []).slice(0, 2).map((tg) => <Tag key={tg}>{tg}</Tag>)}
              </div>

              <span style={{ fontFamily: f.ui, fontSize: 11.5, color: t.t3, fontVariantNumeric: 'tabular-nums', width: 64, textAlign: 'right' }}>
                {(n.date || '').replace(/,\s*\d{4}$/, '')}
              </span>
            </div>
          )
        })}

        {rows.length === 0 && (
          <div style={{ padding: 44, textAlign: 'center', fontFamily: f.body, fontSize: 14, color: t.t3, fontStyle: 'italic' }}>
            No documents match this filter.
          </div>
        )}
      </Card>
    </div>
  )
}
