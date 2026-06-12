// Seed fixtures + static config for Course+ (merged Course × Scribe).
// Ported from the prototype's course-data.jsx. The work spine (areas → projects
// with status/priority/due/tasks/milestones) and the document corpus (notes /
// meetings / artifacts / inbox) seed once per user on first load (see lib/db.js).
// Live Claude replaces the prototype's canned ASK_ANSWERS / BRIEFINGS.

// ── Areas → projects (work spine) ───────────────────────────────
export const SEED_AREAS = [
  { id: 'arrow', name: 'Arrow', open: true, projects: [
    { id: 'csp', name: 'Citrix CSP', status: 'active', priority: 1, due: { m: 9, d: 3, y: 2026 },
      blurb: 'Commercial + novation',
      tasks: [
        { id: 'csp-t1', label: 'Confirm telemetry scope with Arrowsphere', next: true, due: 'Thu', work_type: 'deep' },
        { id: 'csp-t2', label: 'Send novation questions to legal', due: 'Thu' },
        { id: 'csp-t3', label: 'Finalize mid-tier pricing ceiling', waiting: 'legal' },
        { id: 'csp-t4', label: 'Resolve EMEA segmentation question' },
        { id: 'csp-t5', label: 'Draft CSP pricing model v3', done: true },
      ],
      milestones: [
        { id: 'csp-m1', label: 'Pricing model v2', state: 'done', sub: 'May 28' },
        { id: 'csp-m2', label: 'Novation terms closed', state: 'current', sub: 'blocking' },
        { id: 'csp-m3', label: 'Contract close', state: 'upcoming', sub: 'Oct 3' },
      ] },
    { id: 'sgs', name: 'SGS Tracker', status: 'active', priority: 2,
      blurb: 'Handoff — Crawl phase',
      tasks: [
        { id: 'sgs-t1', label: 'Build 02/06 comment updates for each tracker row', next: true, work_type: 'deep' },
        { id: 'sgs-t2', label: 'Chase un-updated lines from absent owners', due: 'Thu' },
        { id: 'sgs-t3', label: 'Draft async updates to Mattia + Diane' },
        { id: 'sgs-t4', label: 'Prep concepts for Ed Lewis review', done: true },
        { id: 'sgs-t5', label: 'Triage Nathalie open items to Notion', done: true },
      ],
      milestones: [
        { id: 'sgs-m1', label: 'Crawl — learn process & people', state: 'current', sub: 'now' },
        { id: 'sgs-m2', label: 'Walk — own the weekly call', state: 'upcoming', sub: 'mid-Jun' },
        { id: 'sgs-m3', label: 'Run — own tooling & workflow', state: 'upcoming' },
      ] },
    { id: 'accenture', name: 'Accenture', status: 'on-hold', priority: 3,
      blurb: 'Paused — awaiting scope', hold: { waitingOn: 'revised scope from Haritha', checkIn: 'Jun 18' },
      tasks: [
        { id: 'acc-t1', label: 'Review revised scope when it lands', waiting: 'Haritha' },
      ],
      milestones: [
        { id: 'acc-m1', label: 'Initial scoping', state: 'done' },
        { id: 'acc-m2', label: 'Revised scope', state: 'upcoming', sub: 'on hold' },
      ] },
  ] },
  { id: 'sds', name: 'Slow Down Sunny', open: true, projects: [
    { id: 'maggetti', name: 'Maggetti proposal', status: 'sent', priority: 2, due: { m: 5, d: 27, y: 2026 },
      blurb: 'Out — valid to Jun 27',
      tasks: [
        { id: 'mag-t1', label: 'Add asset-ownership-on-exit language', next: true },
        { id: 'mag-t2', label: 'Tie review commitment to outreach effort, not a count' },
        { id: 'mag-t3', label: 'Send cover-email follow-up', waiting: 'Mitch' },
        { id: 'mag-t4', label: 'Final proofread of proposal v-final', done: true },
      ],
      milestones: [
        { id: 'mag-m1', label: 'Pitch deck — architectural direction', state: 'done', sub: 'May 26' },
        { id: 'mag-m2', label: 'Proposal sent', state: 'current', sub: 'May 28' },
        { id: 'mag-m3', label: 'Signed', state: 'upcoming', sub: 'by Jun 27' },
      ] },
  ] },
  { id: 'brain', name: 'Second Brain', open: false, projects: [] },
]

// ── Documents (note / meeting / knowledge / brainstorm / artifact) ──
export const SEED_NOTES = [
  { id: 'csp-align', kind: 'meeting', title: 'Commercial Alignment — CSP', project: 'csp', area: 'arrow',
    people: ['Jon', 'Haritha'], tags: ['commercial', 'pricing', 'novation'], date: 'Jun 4, 2026', updated: '2h',
    indexed: true, status: 2, rawWords: '4,210',
    summary: "Novation is the critical path — legal sign-off blocks the pricing tiers. Jon owns pushing legal; telemetry scope and EMEA segmentation remain open. Next checkpoint is Thursday's Arrowsphere call.",
    terms: ['Arrowsphere', 'novation', 'EMEA', 'telemetry'],
    actions: [
      { text: 'Confirm telemetry scope with Arrowsphere', src: 'this meeting', owner: 'you · due Thu' },
      { text: 'Get legal sign-off on novation terms', src: 'Review with Ed (Jun 3)', owner: 'Ed Lewis' },
      { text: 'Resolve EMEA segmentation question', src: 'this meeting', owner: 'open' },
    ],
    body: [
      { p: "Jon reframed the sequencing: pricing tiers can't be finalized until legal closes the novation terms, so novation is now the gating item rather than a parallel workstream. He'll take the push with legal directly." },
      { p: "We walked the telemetry scope for Arrowsphere — segmentation granularity is still unresolved for EMEA, where iAsset / ARM handles quoting separately from NA. Confirm against Lénaïg's old notes before Thursday." },
      { ul: ['Telemetry scope — depth of per-tenant segmentation', 'EMEA vs NA quoting paths feeding Salesforce', 'Whether novation needs a separate addendum'] },
      { links: ['CSP pricing model v2', 'Novation — legal background'] },
    ],
    related: [
      { kind: 'knowledge', title: 'Novation questions for legal', reason: 'shared term: novation' },
      { kind: 'meeting', title: 'SGS weekly tracker call — Jun 2', reason: 'also with: Jon' },
      { kind: 'note', title: 'CSP pricing model v2', reason: 'linked [[ ]]' },
    ] },
  { id: 'csp-terms', kind: 'note', title: 'Commercial terms — open questions', project: 'csp', area: 'arrow',
    people: [], tags: ['commercial', 'pricing'], date: 'Jun 3, 2026', updated: '1d', indexed: true, status: 2,
    summary: 'Running list of unresolved commercial points for CSP: tier thresholds, novation dependency, and the telemetry billing model.',
    body: [
      { p: 'Open commercial questions ahead of contract close. Most are blocked on the novation outcome.' },
      { ul: ['Tier thresholds — confirm the mid-tier ceiling', 'Telemetry billing — per-tenant vs flat', 'Does novation require a pricing addendum?'] },
      { links: ['Commercial Alignment — CSP'] },
    ],
    related: [
      { kind: 'meeting', title: 'Commercial Alignment — CSP', reason: 'same project' },
      { kind: 'note', title: 'CSP pricing model v2', reason: 'shared term: pricing' },
    ] },
  { id: 'csp-pricing', kind: 'note', title: 'CSP pricing model v2', project: 'csp', area: 'arrow',
    people: [], tags: ['pricing', 'reference'], date: 'May 28, 2026', updated: '1w', indexed: true, status: 2,
    summary: 'Second pass at the CSP pricing model — three tiers, telemetry as a metered add-on, novation handled as a contract amendment.',
    body: [
      { p: 'Revised pricing structure after the May review. Tiers stay at three; telemetry moves to a metered add-on rather than bundled.' },
      { ul: ['Starter / Growth / Scale tiers', 'Telemetry metered per active tenant', 'Novation as amendment, not re-paper'] },
    ],
    related: [{ kind: 'note', title: 'Commercial terms — open questions', reason: 'shared term: pricing' }] },
  { id: 'csp-novation', kind: 'knowledge', title: 'Novation — legal background', project: 'csp', area: 'arrow',
    people: [], tags: ['legal', 'reference'], date: 'May 20, 2026', updated: '2w', indexed: true, status: 2,
    summary: 'Reference: what novation means for the CSP contract, who must sign, and the typical timeline with legal.',
    body: [
      { p: 'Novation substitutes one party for another in the existing contract, requiring consent from all three parties. For CSP this means the original reseller, the new entity, and the customer.' },
      { ul: ['All three parties must consent in writing', 'Legal estimates 2–3 weeks once drafted', 'Blocks pricing finalization until closed'] },
    ],
    related: [{ kind: 'knowledge', title: 'Novation questions for legal', reason: 'shared term: novation' }] },
  { id: 'csp-novq', kind: 'knowledge', title: 'Novation questions for legal', project: 'csp', area: 'arrow',
    people: [], tags: ['legal', 'open'], date: 'Jun 2, 2026', updated: '2d', indexed: true, status: 2,
    summary: 'Specific questions to send legal before they draft the novation: consent sequencing, addendum vs re-paper, and EMEA entity handling.',
    body: [{ ul: ['Can consent be sequenced or must it be simultaneous?', 'Addendum vs full re-paper for pricing?', 'Does the EMEA entity need separate handling?'] }],
    related: [{ kind: 'knowledge', title: 'Novation — legal background', reason: 'shared term: novation' }] },
  { id: 'sgs-handoff', kind: 'knowledge', title: 'Handoff from Lénaïg — Crawl / Walk / Run', project: 'sgs', area: 'arrow',
    people: ['Jon', 'Lénaïg', 'Agathe'], tags: ['handoff', 'crawl-walk-run', 'reference'], date: 'May 29, 2026', updated: '1w',
    indexed: true, status: 2,
    summary: "Jon framed the SGS handoff as Crawl / Walk / Run. You're in Crawl: learn the process and people, keep the existing tracker intact, don't slow anyone down, and don't touch tooling or workflow yet. Lénaïg and Agathe keep owning the underlying tracking through roughly mid-June while you take over the weekly call.",
    terms: ['Crawl/Walk/Run', 'tracker', 'ARM', 'SFDC'],
    body: [
      { p: "Context for the SGS Global Project Tracker — the cross-functional Salesforce / ERP / ARM integration program, covering project tracking across EMEA and NA, that you're taking over from Lénaïg." },
      { p: 'Jon set the handoff up as Crawl / Walk / Run. The Crawl mandate is deliberately narrow:' },
      { ul: ['Learn the process, the lines, and the people', 'Keep the existing tracker intact — no structural changes', "Don't slow anyone down", "Explicitly don't touch tooling or workflow yet"] },
      { p: 'Lénaïg and Agathe continue owning the underlying tracking through roughly mid-June; your first concrete responsibility is the weekly call.' },
      { links: ['SGS weekly tracker call — Jun 2', 'Salesforce ↔ ERP ↔ ARM architecture'] },
    ],
    related: [
      { kind: 'meeting', title: 'SGS weekly tracker call — Jun 2', reason: 'same project' },
      { kind: 'knowledge', title: 'Salesforce ↔ ERP ↔ ARM architecture', reason: 'shared term: ARM' },
    ] },
  { id: 'sgs-call', kind: 'meeting', title: 'SGS weekly tracker call — Jun 2', project: 'sgs', area: 'arrow',
    people: ['Jon', 'Kirby'], tags: ['meeting', 'tracker', 'crawl-walk-run'], date: 'Jun 2, 2026', updated: '5d',
    indexed: true, status: 2, rawWords: '3,640',
    summary: 'Your first weekly call. Dense and unfamiliar, and several line owners were absent, so their rows went un-updated. Two follow-ups fell out: get fluent in the substance, and chase the gaps before the stakeholder reviews.',
    terms: ['ARM', 'SFDC', 'ERP', 'tracker'],
    actions: [
      { text: 'Build 02/06 comment updates for each tracker row', src: 'this meeting', owner: 'you · in progress' },
      { text: 'Chase un-updated lines from absent owners', src: 'this meeting', owner: 'you · due Thu' },
      { text: 'Draft async updates to Mattia + Diane', src: 'this meeting', owner: 'you' },
    ],
    body: [
      { p: 'First call I led. A lot of it went over my head, and several owners were absent so their lines went un-updated — the follow-up is twofold: get fluent in the substance, and chase the gaps.' },
      { ul: ['Several line owners absent — rows un-updated', 'Sparse, copy-paste comment updates needed in the "02/06 :" format', 'Mattia and Diane absent — async updates required'] },
      { links: ['Tracker update conventions & line decisions', 'Ed Lewis review — prep & concepts'] },
    ],
    related: [
      { kind: 'knowledge', title: 'Handoff from Lénaïg — Crawl / Walk / Run', reason: 'same project' },
      { kind: 'knowledge', title: 'Tracker update conventions & line decisions', reason: 'shared term: tracker' },
      { kind: 'note', title: 'Nathalie open items — triaged to Notion', reason: 'follow-up' },
    ] },
  { id: 'sgs-conventions', kind: 'knowledge', title: 'Tracker update conventions & line decisions', project: 'sgs', area: 'arrow',
    people: ['Kirby'], tags: ['conventions', 'tracker', 'reference'], date: 'Jun 4, 2026', updated: '3d',
    indexed: true, status: 2,
    summary: "How tracker rows get updated, plus two line decisions. Updates go in as dated copy-paste comments (the 02/06 format). An opening update was re-mapped from ARM-02 to ARM-04. Kirby's end-user deduplication question was resolved by proposing a new standalone line — SFDC-76 (NA, phase 2).",
    terms: ['ARM-04', 'SFDC-76', 'SFDC-47/2', 'deduplication'],
    body: [
      { p: "Working notes on the tracker's update conventions and the judgment calls behind two lines." },
      { ul: ['Updates entered as dated copy-paste comments — e.g. "02/06 :"', 'The slash-suffix (e.g. /2) denotes a sub-phase, not a new scope', 'Opening update re-mapped: belonged to ARM-04, not ARM-02', "Kirby's end-user dedup → new standalone line SFDC-76 (NA, phase 2)"] },
    ],
    related: [
      { kind: 'meeting', title: 'SGS weekly tracker call — Jun 2', reason: 'shared term: tracker' },
      { kind: 'note', title: 'Ed Lewis review — prep & concepts', reason: 'shared term: SFDC' },
    ] },
  { id: 'sgs-ed-prep', kind: 'note', title: 'Ed Lewis review — prep & concepts', project: 'sgs', area: 'arrow',
    people: ['Ed Lewis'], tags: ['review', 'forecasting', 'reference'], date: 'Jun 5, 2026', updated: '2d',
    indexed: true, status: 2,
    summary: 'Prep for Ed’s stakeholder review. Got tutored on the real Salesforce concepts behind his four items, and flagged that "pipeline refinement" isn’t an official term.',
    terms: ['SFDC-30', 'SFDC-32', 'ERP-06', 'SFDC-74'],
    body: [
      { p: "Ahead of Ed's review I worked through the actual Salesforce concepts behind each of his four items so I could speak to them:" },
      { ul: ['SFDC-30 — Forecast / sales hierarchy', 'SFDC-32 — Quotas', 'ERP-06 — end-user classification sync', 'SFDC-74 — opportunity upload template'] },
      { p: 'Also flagged that "pipeline refinement" isn’t an official term, so it shouldn’t anchor the review.' },
      { links: ['Tracker update conventions & line decisions'] },
    ],
    related: [
      { kind: 'meeting', title: 'SGS weekly tracker call — Jun 2', reason: 'review prep' },
      { kind: 'note', title: 'Nathalie open items — triaged to Notion', reason: 'also: stakeholder review' },
    ] },
  { id: 'sgs-nathalie', kind: 'note', title: 'Nathalie open items — triaged to Notion', project: 'sgs', area: 'arrow',
    people: ['Nathalie'], tags: ['triage', 'master-data', 'reference'], date: 'Jun 5, 2026', updated: '2d',
    indexed: true, status: 2,
    summary: "Triaged Nathalie's open tracker items into a dedicated Notion page, grouped into master-data, forecasting, and deal-reg / pricing.",
    terms: ['master-data', 'forecasting', 'deal-reg'],
    body: [
      { p: 'Nathalie had a scattered set of open items. I pulled them into one Notion page and grouped them so the review has structure:' },
      { ul: ['Master-data — ownership and classification fields', 'Forecasting — hierarchy and quota alignment', 'Deal-reg / pricing — registration and pricing edge cases'] },
    ],
    related: [
      { kind: 'note', title: 'Ed Lewis review — prep & concepts', reason: 'also: stakeholder review' },
      { kind: 'meeting', title: 'SGS weekly tracker call — Jun 2', reason: 'same project' },
    ] },
  { id: 'sgs-arch', kind: 'knowledge', title: 'Salesforce ↔ ERP ↔ ARM architecture', project: 'sgs', area: 'arrow',
    people: [], tags: ['reference', 'architecture', 'arm'], date: 'May 30, 2026', updated: '5d', indexed: true, status: 2,
    summary: 'How the three systems connect: Salesforce is the hub feeding both iAsset / ARM (EMEA quoting) and ARS Cloud (NA quoting).',
    terms: ['Salesforce', 'ARM', 'ERP'],
    body: [
      { p: 'iAsset / ARM handles EMEA quoting, ARS Cloud handles NA, and Salesforce is the hub feeding both.' },
      { ul: ['Salesforce = system of record', 'EMEA quoting via iAsset / ARM', 'NA quoting via ARS Cloud'] },
    ],
    related: [{ kind: 'knowledge', title: 'Handoff from Lénaïg — Crawl / Walk / Run', reason: 'shared term: ARM' }] },
  { id: 'arrow-sync', kind: 'meeting', title: 'Arrow weekly — CSP + SGS', project: null, area: 'arrow',
    projects: ['csp', 'sgs'], people: ['Jon', 'Ed Lewis', 'Nathalie'], tags: ['weekly', 'novation', 'arm', 'emea'],
    date: 'Jun 6, 2026', updated: '18h', indexed: true, status: 2, rawWords: '5,020',
    summary: "Cross-project Arrow weekly. CSP: novation is still the blocker, Jon escalating legal. SGS: first tracker call is done and the 02/06 updates are in flight, with Ed's and Nathalie's reviews next. Shared thread — Ed reviews both sides, and the EMEA entity touches the novation paperwork and the tracker's master-data at once.",
    terms: ['novation', 'ARM', 'EMEA', 'tracker'],
    actions: [
      { text: 'Escalate novation sign-off with legal', src: 'this meeting', owner: 'Jon', project: 'csp' },
      { text: 'Confirm EMEA entity handling — affects both', src: 'this meeting', owner: 'you · due Thu', project: 'csp' },
      { text: 'Finish 02/06 tracker updates before Ed’s review', src: 'this meeting', owner: 'you · due Thu', project: 'sgs' },
    ],
    body: [
      { p: 'Combined Arrow weekly covering both live projects. Most of the shared time was the EMEA-entity question, which sits on the critical path for CSP (novation paperwork) and SGS (master-data / ARM) at once.' },
      { ul: ['CSP — novation blocking pricing; Jon escalating legal', 'SGS — first tracker call done; chasing un-updated lines before Ed’s review', 'Shared — EMEA entity affects both; resolve before either closes'] },
      { links: ['Commercial Alignment — CSP', 'SGS weekly tracker call — Jun 2'] },
    ],
    related: [
      { kind: 'meeting', title: 'Commercial Alignment — CSP', reason: 'routed action: CSP' },
      { kind: 'meeting', title: 'SGS weekly tracker call — Jun 2', reason: 'routed action: SGS' },
    ] },
  { id: 'mag-overview', kind: 'note', title: 'Maggetti — engagement overview', project: 'maggetti', area: 'sds',
    people: ['Mitch'], tags: ['engagement', 'consulting', 'reference'], date: 'May 20, 2026', updated: '2w',
    indexed: true, status: 2,
    summary: "Paid digital-marketing engagement through Slow Down Sunny LLC for Maggetti Construction — Mitch's high-end Willow Glen builder serving Los Gatos, Saratoga and Los Altos. The core gap: a top-1% BuildZoom reputation over 35+ years against a near-absent digital presence.",
    terms: ['BuildZoom', 'Squarespace', 'Houzz', 'Angi'],
    body: [
      { p: 'Maggetti Construction is a high-end San Jose builder (Willow Glen), 35+ years in, top-1% on BuildZoom, with a strong word-of-mouth reputation across Los Gatos, Saratoga and Los Altos.' },
      { p: 'The problem is the gap between that real-world standing and the digital footprint:' },
      { ul: ['Effectively zero Google reviews', 'An underoptimized Squarespace site', 'A small Instagram following', 'Dormant Houzz / Angi profiles'] },
      { links: ['Competitive research — De Mattei benchmark', 'Three-package pitch structure'] },
    ],
    related: [
      { kind: 'knowledge', title: 'Competitive research — De Mattei benchmark', reason: 'same project' },
      { kind: 'note', title: 'Three-package pitch structure', reason: 'same project' },
    ] },
  { id: 'mag-research', kind: 'knowledge', title: 'Competitive research — De Mattei benchmark', project: 'maggetti', area: 'sds',
    people: [], tags: ['research', 'competitive', 'reference'], date: 'May 22, 2026', updated: '2w',
    indexed: true, status: 2,
    summary: 'Local competitor scan. De Mattei Construction is the one rival with a real social presence and the main benchmark; most comparable builders are similarly thin online, which is the opening.',
    terms: ['De Mattei', 'Instagram', 'Google reviews'],
    body: [
      { p: 'Scanned the high-end builders in the area. The pattern: strong reputations, weak digital — with one exception.' },
      { ul: ['De Mattei Construction — the only rival with real social presence', 'Most peers: minimal reviews, dated sites', 'Opening: own search + reviews before competitors invest'] },
    ],
    related: [
      { kind: 'note', title: 'Maggetti — engagement overview', reason: 'same project' },
      { kind: 'note', title: 'Three-package pitch structure', reason: 'informs scope' },
    ] },
  { id: 'mag-packages', kind: 'note', title: 'Three-package pitch structure', project: 'maggetti', area: 'sds',
    people: [], tags: ['pitch', 'proposal', 'pricing'], date: 'May 25, 2026', updated: '10d',
    indexed: true, status: 2,
    summary: 'Three tiers: Foundation, Foundation + Launch, and Foundation + Managed retainer. Foundation fixes the basics; Launch adds a campaign; the retainer adds ongoing reputation / listings upkeep and paid-ad management.',
    terms: ['Foundation', 'Launch', 'retainer'],
    body: [
      { p: 'Pitch is structured as three packages so Mitch can choose his level of commitment:' },
      { ul: ['Foundation — reviews, listings cleanup, Squarespace optimization', 'Foundation + Launch — adds a kickoff campaign', 'Foundation + Managed retainer — adds ongoing upkeep and paid-ad management'] },
      { links: ['Pitch deck — architectural direction', 'Proposal v-final — Slow Down Sunny → Maggetti'] },
    ],
    related: [
      { kind: 'artifact', title: 'Proposal v-final — Slow Down Sunny → Maggetti', reason: 'same project' },
      { kind: 'artifact', title: 'Pitch deck — architectural direction', reason: 'same project' },
    ] },
  { id: 'mag-deck', kind: 'artifact', title: 'Pitch deck — architectural direction', project: 'maggetti', area: 'sds',
    people: [], tags: ['deliverable', 'deck'], date: 'May 26, 2026', updated: '1w',
    indexed: true, status: 2,
    summary: 'Eight-slide pitch deck in an architectural visual direction — Cormorant Garamond + Inter on a near-white background. Source material for the formal proposal.',
    terms: ['deck', 'Cormorant Garamond', 'Inter'],
    body: [
      { p: 'Eight slides, built to feel architectural: Cormorant Garamond display over Inter, near-white ground, generous margins. Walks from the reputation / digital gap through the three packages.' },
    ],
    related: [
      { kind: 'note', title: 'Three-package pitch structure', reason: 'composed from' },
      { kind: 'artifact', title: 'Proposal v-final — Slow Down Sunny → Maggetti', reason: 'same project' },
    ] },
  { id: 'mag-proposal', kind: 'artifact', title: 'Proposal v-final — Slow Down Sunny → Maggetti', project: 'maggetti', area: 'sds',
    people: ['Mitch'], tags: ['deliverable', 'proposal', 'pricing'], date: 'May 28, 2026', updated: '4d',
    indexed: true, status: 2,
    summary: 'Formal proposal under Slow Down Sunny LLC, signed by you, dated May 28 with a June 27 validity window. Managed scope expanded to reputation / listings upkeep + paid-ad management; monthly fee $1,000; financial summary set to a first-six-months total of $8,600.',
    terms: ['$8,600', '$1,000/mo', 'retainer'],
    body: [
      { p: 'The contracting entity is Slow Down Sunny LLC throughout, with you as the signing party. Dated May 28, valid through June 27.' },
      { ul: ['Monthly managed fee — $1,000', 'First-six-months total — $8,600', 'Managed scope — reputation / listings upkeep + paid-advertising management', 'Platform ad spend paid directly by Maggetti, kept separate from the fee'] },
      { links: ['Proposal review — gaps & cover email'] },
    ],
    related: [
      { kind: 'note', title: 'Three-package pitch structure', reason: 'composed from' },
      { kind: 'note', title: 'Proposal review — gaps & cover email', reason: 'reviewed in' },
    ] },
  { id: 'mag-review', kind: 'note', title: 'Proposal review — gaps & cover email', project: 'maggetti', area: 'sds',
    people: [], tags: ['review', 'proposal', 'open'], date: 'May 30, 2026', updated: '2d',
    indexed: true, status: 2,
    summary: 'Review pass before sending. Tightened the cover email and flagged two substantive gaps in the proposal to close.',
    terms: ['cover email', 'asset ownership', 'review commitment'],
    body: [
      { p: 'Cover-email cleanup: a term-length typo, a capitalization slip, some redundancy, and a tone mismatch (a "no rush" line sitting next to "let’s meet next week").' },
      { p: 'Two substantive gaps to close in the proposal itself:' },
      { ul: ["Add language confirming all accounts and assets remain the client's property at engagement end", 'Tie the review commitment to outreach effort rather than a guaranteed count'] },
    ],
    related: [
      { kind: 'artifact', title: 'Proposal v-final — Slow Down Sunny → Maggetti', reason: 'reviews' },
    ] },
  { id: 'voyage', kind: 'knowledge', title: 'Voyage 4 embeddings — shared vector space', project: null, area: null,
    people: [], tags: ['reference', 'reading'], date: 'Jun 1, 2026', updated: '3d', indexed: false, status: 1,
    summary: 'voyage-4-large and voyage-4-lite embed into one space — index with large, query with lite, no re-index.',
    body: [{ p: 'Relevant to v2 search: index with the large model, query with lite, single shared space.' }], related: [] },
  { id: 'brainstorm-name', kind: 'brainstorm', title: 'Naming — the compose feature', project: null, area: null,
    people: [], tags: ['ideas'], date: 'May 31, 2026', updated: '1w', indexed: true, status: 2,
    summary: 'Loose ideas for what to call the deliverable-composition feature.',
    body: [{ ul: ['Compose', 'Draft', 'Assemble', 'Spin up'] }], related: [] },
]

// ── Inbox captures (untriaged) ──────────────────────────────────
export const SEED_INBOX = [
  { id: 'in-arrow', title: 'Arrow weekly — combined notes', src: 'apple shortcut', srcIcon: 'brand-apple',
    snippet: "Covered CSP novation (Jon escalating legal) and the SGS tracker — first weekly call done, chasing the lines absent owners left un-updated before Ed's review. Shared: Ed reviews both sides.",
    suggest: null, tags: ['weekly', 'novation', 'arm', 'emea'],
    suggestMulti: { home: 'arrow', homeLabel: 'Arrow', confidence: 0.88, routes: [{ project: 'csp', count: 2 }, { project: 'sgs', count: 1 }] } },
  { id: 'in-ed', title: 'Notes from Ed Lewis 1:1', src: 'apple shortcut', srcIcon: 'brand-apple',
    snippet: 'Ed wants his four review items walked — forecast hierarchy, quotas, end-user classification sync, opportunity upload — and flagged that "pipeline refinement" isn’t an official term. Async updates to Mattia + Diane still pending.',
    suggest: { project: 'sgs', confidence: 0.92 }, tags: ['review', 'follow-up'] },
  { id: 'in-mag', title: 'Maggetti — cover email & proposal review notes', src: 'captured', srcIcon: 'clipboard',
    snippet: "Tightened the cover email (typo, capitalization, a no-rush vs let's-meet-next-week tone mismatch). Two proposal gaps to close: asset ownership at engagement end, and tying the review commitment to outreach effort rather than a guaranteed count.",
    suggest: { project: 'maggetti', confidence: 0.9 }, tags: ['review', 'proposal'] },
  { id: 'in-voyage', title: 'Voyage 4 embeddings — shared vector space', src: 'captured', srcIcon: 'clipboard',
    snippet: 'voyage-4-large and voyage-4-lite embed into one space — index with large, query with lite, no re-index. Relevant to v2 search.',
    suggest: null, tags: ['reference', 'reading'] },
  { id: 'in-arm', title: 'ARM quoting flow — EMEA via iAsset', src: 'manual', srcIcon: 'pencil',
    snippet: "iAsset/ARM handles EMEA quoting, ARS Cloud handles NA, Salesforce is the hub feeding both. Confirm with Lénaïg's old notes.",
    suggest: { project: 'sgs', confidence: 0.78 }, tags: ['reference', 'arm'] },
]

// ── Static config ───────────────────────────────────────────────
export const TOPICS = ['novation', 'pricing', 'arm', 'proposal', 'review']

export const COMPOSE_TYPES = [
  { id: 'auto', icon: 'sparkles', name: 'Auto', desc: 'Claude picks the best format' },
  { id: 'document', icon: 'file-text', name: 'Document', desc: 'Clean written document' },
  { id: 'csv', icon: 'table', name: 'CSV', desc: 'Pipe-separated table ( | )' },
  { id: 'copilot', icon: 'prompt', name: 'Copilot prompt', desc: 'Ready-to-paste M365 Copilot prompt' },
]

// Suggested Ask questions (shown before first query)
export const ASK_SUGGESTIONS = [
  'What did Jon say about novation last week?',
  'What’s blocking CSP right now?',
  'What’s still open on the Maggetti proposal?',
  'Where are we on the SGS tracker handoff?',
]
