// Series ↔ calendar reconciliation, and the one agenda-composition rule.
//
// A recurring meeting exists in two places: as a cp_series (standing agenda,
// instance history) and as the real calendar event in placed_blocks that Today
// ingests and the Agenda screen lists. These helpers join them by title, so
// starting the meeting from the calendar gets the same pre-fill as starting it
// from the series page.
//
// Pure — no React, no DOM, no Supabase — so both the composer and the series
// screen can share it without an import cycle.

// Calendar titles are typed by humans and re-emitted by an ical feed, so match
// forgivingly: case, surrounding space, collapsed inner runs, and the invisible
// junk calendars love (nbsp, zero-width) all stop mattering.
export function normalizeTitle(s = '') {
  return String(s)
    .replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

// Every calendar title a series answers to: the explicit bindings plus its own
// name, so a series named exactly like the calendar block works with no setup.
export function titlesForSeries(s) {
  const out = new Set()
  for (const raw of [...(s?.calendarTitles || []), s?.name]) {
    const norm = normalizeTitle(raw)
    if (norm) out.add(norm)
  }
  return out
}

// The series that owns a calendar title, if any. Archived series are ignored so
// an old series can't keep capturing meetings.
export function seriesForTitle(seriesList = [], title = '') {
  const want = normalizeTitle(title)
  if (!want) return null
  // Prefer an explicit calendar binding over a name coincidence: if two series
  // could match, the one that was deliberately bound wins.
  const live = seriesList.filter((s) => s && !s.archived)
  const bound = live.find((s) => (s.calendarTitles || []).some((c) => normalizeTitle(c) === want))
  return bound || live.find((s) => normalizeTitle(s.name) === want) || null
}

// What a new meeting in this series opens with. Layers, each skipped when
// empty, so a bare series behaves exactly as it did before any of this:
//   1. the standing agenda — the checklist walked every time, verbatim
//   2. still-open tasks carried from earlier meetings in the series
//   3. the AI prep if one was generated, else the raw next-steps rollup
export function buildSeriesAgenda({ series, openTasks = [], openThreads = [], prep = '' } = {}) {
  const parts = []
  const tpl = (series?.standingAgenda || '').trim()
  if (tpl) parts.push(tpl)
  if (openTasks.length) {
    parts.push('## Open from earlier meetings\n' + openTasks
      .map((tk) => `- [ ] ${tk.label}${tk.projectName ? ` _(${tk.projectName})_` : ''}`)
      .join('\n'))
  }
  if (prep && prep.trim()) parts.push('## Prep\n' + prep.trim())
  else if (openThreads.length) {
    parts.push('## Carried over\n' + openThreads
      .map((o) => `From ${o.date || 'last time'}:\n${o.text}`)
      .join('\n\n'))
  }
  return parts.join('\n\n')
}
