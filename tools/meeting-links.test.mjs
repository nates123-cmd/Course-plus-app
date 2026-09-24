// node tools/meeting-links.test.mjs — next-steps parsing + "ask Jon next meeting" matching.
import assert from 'node:assert/strict'
import { parseNextSteps, transcriptExcerpt, isDuplicateStep } from '../src/lib/nextSteps.js'
import { resolveFreeText, encodePersonLink, parsePersonLink, linkMatchesTitle, meetingLabel, nameCandidates } from '../src/lib/meetingMatch.js'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }

// Real shape of cp_notes.next_steps (Ed Meeting, 2026-09-24)
const md = `## Immediate Actions
- **Kirby** → confirm if Deal Reg is part of the NA partner portal; quick win to answer Cedric's partner visibility ask
- **Form test** → submit a Deal Reg form yourself to baseline the current confirmation UX before pushing for the auto-email

## Short-Term Follow-Ups
- Pin down UAT ownership for the Deal Reg → Opportunity link in NA so EMEA reuse can be properly scoped
- Ok fine`
const steps = parseNextSteps(md)
ok(steps.length === 3, 'three bullets, the two-word one dropped: ' + steps.length)
ok(steps[0].label.startsWith('Kirby: confirm if Deal Reg'), steps[0].label)
ok(!steps[0].label.includes('**'), 'bold stripped')
ok(steps[0].section === 'Immediate Actions' && steps[2].section === 'Short-Term Follow-Ups', 'sections')
ok(steps.every((s) => s.label.length <= 111), 'labels capped')
ok(steps[0].detail && steps[0].detail.includes('quick win'), 'long bullet keeps full text as detail')
ok(parseNextSteps('- Follow up with Agathe on SFDC-63 end-of-week update')[0].detail === null, 'short bullet has no detail')
ok(parseNextSteps('').length === 0 && parseNextSteps(null).length === 0, 'empty')

// "3 - 4%" is not a clause break; trailing periods go
const pct = parseNextSteps("- Publish internal comms clarifying that existing CSP partners' 3 - 4% renewal price guarantee is honored under new TCCs for everyone involved in the rollout.")[0]
ok(pct.label.includes('3 - 4%'), pct.label)
ok(!parseNextSteps('- Add 2 dedicated audit headcount to FY27 budget.')[0].label.endsWith('.'), 'trailing period')

// dedup: the action item from the same meeting that restates the step (real pair)
const step = 'Pin down UAT ownership for the Deal Reg: Opportunity link in NA so EMEA reuse can be properly scoped'
const action = 'Investigate who is doing UAT on the Deal Reg to Opportunity link in NA'
ok(isDuplicateStep(step, { label: action, sameMeeting: true }), 'same-meeting restatement is a dup')
ok(!isDuplicateStep(step, { label: action, sameMeeting: false }), 'looser rule only within the same meeting')
ok(isDuplicateStep('Ask Kim about the My Business EMEA rollout timeline', { label: 'Kim: ask about My Business EMEA rollout timeline' }), 'near-identical anywhere')
ok(!isDuplicateStep('Schedule a dedicated October session on CSA-to-CSP migration policy', { label: 'Confirm October release timeline', sameMeeting: true }), 'shared month is not a dup')

const tr = 'Speaker A: Setting the stage.\nSpeaker B: We need to confirm whether deal reg is in the NA partner portal.\nSpeaker A: Kirby would know.\nSpeaker C: Lunch?'
const ex = transcriptExcerpt(tr, 'Kirby: confirm if Deal Reg is part of the NA partner portal')
ok(ex.some((l) => l.hit && l.text.includes('partner portal')), 'excerpt finds the line')
ok(transcriptExcerpt(tr, 'buy a boat tomorrow').length === 0, 'no overlap -> no excerpt')

// "ask Jon next meeting" -> the JS/NS 1:1 (initials) when nothing names Jon
const meetings = [
  { id: 1, title: 'Rev Ops Team Meeting', when: 3, recurring: true, people: [] },
  { id: 2, title: 'JS/NS 1:1', when: 2, recurring: true, people: [] },
  { id: 3, title: 'Ed <> Nate Weekly', when: 1, recurring: true, people: [] },
]
ok(nameCandidates('ask Jon next meeting')[0] === 'Jon', 'name pulled from dictation')
let r = resolveFreeText('ask Jon next meeting', meetings)
ok(r && r.name === 'Jon' && r.meetings[0].title === 'JS/NS 1:1' && r.weak, 'initials fallback')
r = resolveFreeText('raise with ed', meetings)
ok(r && r.name === 'Ed' && r.meetings.length === 1 && !r.weak, 'lowercase name, title hit')
// a series that lists Jon by name beats initials, soonest first
r = resolveFreeText('Jon', [...meetings, { id: 4, title: 'Arrow Staff', when: 0, recurring: true, people: ['Jon Smith'] }])
ok(r.meetings.length === 1 && r.meetings[0].title === 'Arrow Staff' && !r.weak, 'people beats initials')
ok(resolveFreeText('ask about the budget', meetings) === null, 'no person -> null')

// person link round-trip + matching
const link = encodePersonLink('Jon', ['JS/NS 1:1', 'Arrow Staff'])
ok(link === '@Jon: JS/NS 1:1 | Arrow Staff', link)
const pl = parsePersonLink(link)
ok(pl.name === 'Jon' && pl.titles.length === 2 && pl.titles[0] === 'JS/NS 1:1', 'parse keeps the colon inside 1:1')
ok(linkMatchesTitle(link, 'js/ns 1:1 ') && linkMatchesTitle(link, 'Arrow Staff'), 'matches its titles')
ok(linkMatchesTitle(link, 'Jon / Nate catch-up'), 'matches a title naming Jon')
ok(!linkMatchesTitle(link, 'Ed <> Nate Weekly'), 'not other meetings')
ok(linkMatchesTitle('JS/NS 1:1', 'JS/NS 1:1') && !linkMatchesTitle('JS/NS 1:1', 'Ed'), 'plain titles still exact')
ok(meetingLabel(link) === 'Next with Jon' && meetingLabel('JS/NS 1:1') === 'JS/NS 1:1', 'labels')

console.log(n + ' assertions passed')
