// Markdown-ish text <-> structured note body blocks ({p}|{ul}|{ol}|{links}).
const OL_LINE = /^\d+[.)]\s+/ // "1. " or "1) "
export const blocksToText = (blocks = []) => blocks.map((b) => {
  if (b.p) return b.p
  if (b.ul) return b.ul.map((i) => '- ' + i).join('\n')
  if (b.ol) return b.ol.map((i, n) => (n + 1) + '. ' + i).join('\n')
  if (b.links) return b.links.map((l) => `[[${l}]]`).join(' ')
  return ''
}).join('\n\n')

export const textToBlocks = (text) => (text || '').split(/\n{2,}/).map((chunk) => {
  const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return null
  if (lines.every((l) => l.startsWith('- ') || l.startsWith('* '))) return { ul: lines.map((l) => l.slice(2).trim()) }
  if (lines.every((l) => OL_LINE.test(l))) return { ol: lines.map((l) => l.replace(OL_LINE, '').trim()) }
  const links = chunk.match(/\[\[(.+?)\]\]/g)
  const stripped = chunk.replace(/\[\[(.+?)\]\]/g, '').replace(/(\s|,|and)/gi, '').trim()
  if (links && stripped === '') return { links: links.map((m) => m.slice(2, -2)) }
  return { p: chunk.replace(/\n/g, ' ').trim() }
}).filter(Boolean)
