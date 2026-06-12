// Markdown-ish text <-> structured note body blocks. Legacy blocks are
// {p}|{ul}|{ol}|{links}; rich bodies are stored as a single {md} block holding
// a full markdown string (headings, tables, indent — things the legacy block
// shape can't express). blocksToText flattens either to a markdown string.
const OL_LINE = /^\d+[.)]\s+/ // "1. " or "1) "
export const blocksToText = (blocks = []) => blocks.map((b) => {
  if (b.md != null) return b.md
  if (b.p) return b.p
  if (b.ul) return b.ul.map((i) => '- ' + i).join('\n')
  if (b.ol) return b.ol.map((i, n) => (n + 1) + '. ' + i).join('\n')
  if (b.links) return b.links.map((l) => `[[${l}]]`).join(' ')
  return ''
}).join('\n\n')

// Save a note body edited as markdown — store it as one {md} block so all the
// rich markdown (headings/tables/nested indent) round-trips losslessly.
export const markdownToBlocks = (md) => [{ md: String(md || '') }]

const UL_LINE = /^[-*•]\s+/ // "- ", "* ", "• "
const CHECK = /^[-*•]\s+\[\s?\]\s+/ // "- [ ] " checklist → treated as a bullet
// Line-aware parse: consecutive bullet / numbered lines group into {ul}/{ol}
// even with no blank line separating them from preceding text, and paragraphs
// flush on a blank line. Fixes lists typed right under a paragraph.
export const textToBlocks = (text) => {
  const lines = (text || '').replace(/\r/g, '').split('\n')
  const blocks = []
  let para = [], ul = [], ol = []
  const flushPara = () => {
    if (!para.length) return
    const joined = para.join(' ').trim(); para = []
    const links = joined.match(/\[\[(.+?)\]\]/g)
    const stripped = joined.replace(/\[\[(.+?)\]\]/g, '').replace(/(\s|,|and)/gi, '').trim()
    if (links && stripped === '') blocks.push({ links: links.map((m) => m.slice(2, -2)) })
    else if (joined) blocks.push({ p: joined })
  }
  const flushUl = () => { if (ul.length) { blocks.push({ ul: ul.slice() }); ul = [] } }
  const flushOl = () => { if (ol.length) { blocks.push({ ol: ol.slice() }); ol = [] } }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { flushPara(); flushUl(); flushOl(); continue }
    if (UL_LINE.test(line)) { flushPara(); flushOl(); ul.push(line.replace(CHECK, '').replace(UL_LINE, '').trim()); continue }
    if (OL_LINE.test(line)) { flushPara(); flushUl(); ol.push(line.replace(OL_LINE, '').trim()); continue }
    flushUl(); flushOl(); para.push(line)
  }
  flushPara(); flushUl(); flushOl()
  return blocks
}
