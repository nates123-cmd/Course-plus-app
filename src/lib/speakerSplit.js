// Normalize a pasted transcript that marks speaker turns INLINE instead of one
// per line.
//
// Teams and Copilot put every turn on its own line, which is what parseLines
// expects. Plenty of other tools (and most "upload an mp3" services) emit one
// continuous paragraph with bare "Speaker 1" / "Speaker A" markers embedded in
// the prose:
//
//   Speaker 1 do proof of concept demos … Speaker 2 Yeah. Speaker 1 I don't know.
//
// parseLines splits on \n, so that whole transcript collapses into a SINGLE line
// and the entire meeting is attributed to one speaker. An hour-long note ends up
// as one 55k-character block, and synthesis reads it as an undifferentiated wall.
//
// This inserts the line breaks those tools left out, and adds the colon that
// parseLines' "Name: text" branch looks for.

// "Speaker 1", "Speaker 12", "Speaker A", "SPEAKER_02", "spk 3".
const MARKER = /\b(?:speakers?|spk)[\s_-]*(\d{1,3}|[A-Z])\b[:.—-]*\s*/gi

// Only rewrite when the markers really are inline. A transcript that already has
// its turns on separate lines must come through untouched, so require that the
// markers meaningfully outnumber the line breaks — i.e. most markers are sitting
// mid-line. Also require a few of them, so a note that merely mentions
// "Speaker 2" once in passing is left alone.
const MIN_MARKERS = 3

export function hasInlineSpeakers(text) {
  const s = String(text || '')
  if (!s) return false
  MARKER.lastIndex = 0
  const markers = (s.match(MARKER) || []).length
  if (markers < MIN_MARKERS) return false
  const lines = s.split('\n').filter((l) => l.trim()).length
  // Already one-turn-per-line (or better) → nothing to do.
  return markers > lines
}

// Insert a newline before each inline speaker marker and normalize it to
// "Speaker N: ". Returns the text unchanged when it isn't the inline shape.
export function splitInlineSpeakers(text) {
  const s = String(text || '').replace(/\r/g, '')
  if (!hasInlineSpeakers(s)) return s
  MARKER.lastIndex = 0
  const out = s.replace(MARKER, (m, who, offset) => {
    const label = `Speaker ${String(who).toUpperCase()}: `
    // Don't open the transcript with a blank line.
    return offset === 0 ? label : `\n${label}`
  })
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
}
