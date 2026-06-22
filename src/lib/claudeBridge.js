// Claude.ai handoff bridge — the "run on my Claude subscription" path.
//
// WHY: the in-app AI surfaces (Ask, Generate artifact, …) call the metered
// `claude` edge proxy, billed to Nate's Anthropic API credits. Course+ also
// exposes an MCP server ("Course Plus" connector) that claude.ai/Desktop can
// read + write through, billed to the Pro/Max SUBSCRIPTION instead.
//
// MCP runs the OPPOSITE direction from in-app inference: the web app cannot
// call out to the subscription. So instead of running the model here, this
// module builds an INSTRUCTION prompt and opens claude.ai with it prefilled.
// Claude pulls the data itself via the Course Plus connector and (for
// artifacts) writes the result straight back with create_artifact — so the
// URL stays tiny: we pass IDs + the task, never the corpus.
//
// Tradeoff vs the proxy: one hop to claude.ai, not auto-sent, but $0 API.

const CONNECTOR = 'Course Plus' // name of the MCP connector as it appears in claude.ai

// claude.ai prefills the composer from ?q=. Undocumented but stable; we ALSO
// copy the prompt to the clipboard so an empty box is one paste away.
export function openInClaude(prompt) {
  try { navigator.clipboard?.writeText(prompt) } catch {}
  const url = 'https://claude.ai/new?q=' + encodeURIComponent(prompt)
  const w = window.open(url, '_blank', 'noopener')
  // Popup blocked → caller still has the clipboard copy; signal so UI can say so.
  return !!w
}

// Ask — answer a question over the note corpus, on the subscription.
export function askPrompt(question, { projectName } = {}) {
  const scope = projectName
    ? `Scope the search to the project "${projectName}" (use get_project / list_notes for it).`
    : 'Search across all my notes (list_notes, get_note).'
  return [
    `Using the ${CONNECTOR} connector, answer this question about my work:`,
    '',
    question.trim(),
    '',
    scope,
    'Cite which notes you drew the answer from.',
  ].join('\n')
}

// Generate artifact — compose a deliverable and SAVE it back to the project.
export function composePrompt({ typeName, typeId, projectId, projectName, instructions, scope = 'project', areaName }) {
  const reach = scope === 'pillar' && areaName
    ? `Pull context from EVERY project in the "${areaName}" pillar/area, not just this one (list_projects, then get_project for the siblings).`
    : `Read this project's notes and meeting transcripts in full (list_notes then get_note for each — use the detail, not just summaries).`
  return [
    `Using the ${CONNECTOR} connector, compose a ${typeName} for my project "${projectName}" (project id: ${projectId}).`,
    '',
    reach,
    instructions ? `Instructions: ${instructions.trim()}` : 'Follow the standard format for this deliverable.',
    typeId === 'message' ? 'Write it in my own voice — warm but purpose-first, contractions, no em-dashes.' : '',
    '',
    `When done, SAVE it back with create_artifact (project_id: ${projectId}, artType: "${typeId}"). Then show me the result.`,
  ].filter(Boolean).join('\n')
}
