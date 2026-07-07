---
name: design-audit
description: Mechanical decision checklist for auditing a high-fidelity design (HTML prototype, mockup, design library) against an existing codebase BEFORE writing any UI code. Use whenever the user provides design files to replace or restyle an existing UI, asks for an "audit first" pass, asks which components to rebuild vs reuse, or asks to reconcile a prototype with shipped components. Also use when resuming UI work on a screen whose prototype lives in the repo (prototypes/, design library) to classify drift. Produces: component verdict table, token delta, lettered conflict list, defaults-with-notice list — then STOPS for user confirmation.
---

# Design audit — decision checklist

Classify every component into exactly one verdict: **keep as-is / modify lightly / modify heavily / not-in-design / rebuild from scratch / blocked-on-conflict**. Then split every deviation into **default-with-notice** vs **needs-approval**. Do not write component code during an audit. End the audit by stopping and waiting.

Why this exists: silently retrofitting a design into old components (or silently "fixing" the design to match the code) creates drift the user discovers weeks later. The audit's job is to make every resolution visible *before* it happens.

## Step 0 — Provenance check (always first, before any classification)

IF the user hands you design files → search the repo for prior design sources **before reading any component code**: `Glob` for `prototypes/**`, `*design*library*`, `*.html` at root, and read the header comments of any `tokens.css` / theme file (they often cite their extraction source).

IF prior design files exist in the repo → **byte-diff** each provided file against its repo counterpart (`diff -q`, then `diff | wc -l` for changed ones).

Then branch:

- **IF all files identical** → the "new design" is the design the code was already built from. The task is a **drift audit**: implementation vs its own source. Consequences:
  - Component CSS shells are presumptively *keep as-is* (they were extracted from this exact source); expect drift in JS-rendered content, copy, and small affordances instead.
  - "Rebuild from scratch" is presumptively off the table — flag it only if you find a component whose DOM structure genuinely diverged.
  - Token step reduces to a verification diff (expect zero additions).
- **IF files differ** → run a **two-layer audit**: (1) diff the design files themselves and classify each hunk as token change / component-variant change / new component / layout change; (2) then classify implementation drift against the *old* design. A component can be "keep as-is vs old design" but "rebuild vs new design" — report both columns. Token extraction becomes mandatory, not verificational.
- **IF no prior design source in repo** → greenfield audit: extract the full token set first, then map every design component to its nearest codebase equivalent before classifying.

IF the repo has an existing conflict log convention (this repo: `/* CONFLICT, resolved: ... */` comments in CSS, `docs/*workflow*`) → read it before classifying; a deviation that is *documented and justified* counts as fidelity, not drift.

## Step 1 — Tokens (before any component verdict)

- Diff the design's `:root` / theme blocks against the repo token file **value-by-value, byte-wise**. Exact hex/rgba only; never substitute a "nearest" framework value.
- IF a design value has no token → list it as a token addition (name it in the file's existing naming scheme).
- IF two design files disagree on a token value (calibration example: design library + Tasks/Today prototypes use `0.14` dark-mode soft alphas; Finance/Habits/Schedule use `0.18`) → do NOT pick silently. Check which side any existing repo standardization took:
  - IF the repo standardized on the value the **audited screen's own source** uses → state that and move on.
  - IF the repo standardized **against** the audited screen's source AND the token is visible on this screen → that is a Step 3 Q3 conflict, even though "it's already decided". The prior pick was made while auditing a *different* screen; this screen's fidelity was never ruled on. *(Calibration: Schedule's dark-mode event blocks render at 0.14 alpha vs its prototype's 0.18.)*
- Verify any provenance claims in token-file comments ("extracted verbatim from X", "verified identical across…") against the actual values. A comment that overclaims is itself a finding to report — future audits will trust it.

## Step 2 — Component verdicts

For each component in the design, find its codebase equivalent and apply the FIRST rule that matches:

**BLOCKED-ON-CONFLICT** — IF correct rendering depends on an unanswered question: a data field that may not exist, two design sources that disagree, or design-referenced UI with no design anywhere. Do not half-implement; classify, list the conflict (Step 3), and move on. *(Calibration: metrics strip — 3 of 4 trend indicators need data that isn't stored.)*

**KEEP AS-IS** — IF ALL of:
- DOM structure matches the design 1:1 (same wrappers, same grid columns);
- the CSS was extracted from / matches the design source (byte-level or documented-equivalent);
- every piece of rendered content is derivable from existing data;
- any deviations that do exist are documented, justified fixes of design bugs (e.g., inline `style="..."` in the prototype extracted into real classes — that's fidelity to intent, not drift).
*(Calibration: app shell, capture card.)*

**MODIFY LIGHTLY** — IF structure and CSS match, but rendered content drifts, AND every fix is:
- local (one render function, a few lines),
- needs **no new CSS class** and **no new shared helper**,
- needs **no data that doesn't already exist**.
Typical signals: missing button icons, wrong label/copy, a count badge shown where the design omits it, a missing keyboard hint. *(Calibration: page head — missing SVGs + sub-line wording; view tabs — counts on two tabs the design leaves bare.)*

**MODIFY HEAVILY** — IF the component shell survives but ANY of these thresholds is crossed:
- **≥3 independent drift items** inside one component (count them; independent = fixable separately), OR
- any single drift requires a **new shared helper or new CSS block** (e.g., a relative-time formatter in the shared lib), OR
- any drift is **entangled with a data-availability question** (part renderable now, part blocked).
Treat it as its own unit of work: implement and show it to the user separately, never bundled into a bulk commit. *(Calibration: detail pane — meta grid 2→4 fields with icons, eyebrow semantics, notes action label, activity timestamps needing a new `format.js` helper, pane-meta copy: five drifts, one new helper, two fields blocked on schema → heavily.)*

**NOT-IN-DESIGN** — IF the component exists in code but appears in **no design file** (extra views, modals, interaction states like drag/keyboard-selection outlines). Verdict: **keep + notice**. Design silence is not prohibition; these are usually deliberate scope beyond the prototype (check phase docs / code comments for their rationale). Do NOT classify them as drift, and do NOT remove or restyle them to "match the design" — removal routes through Step 3 question 2. *(Calibration: Schedule's Month/Agenda/Theme-editor views, event and log modals, drag-to-reschedule — the prototype only shows Week view.)*

**REBUILD FROM SCRATCH** — IF the DOM hierarchy differs (different nesting, different column model), OR matching the design would mean rewriting more than half the component's rules, OR the "same-named" component in the codebase is actually a *different sibling component* (e.g., a compact dashboard `.task-row` vs the full interactive pane `.task-row`). In the sibling case, rebuild **under a new scope/name** (`.pane .task-row`) rather than mutating the shared class — never let two designs fight over one selector.

Report as a table: component | current location (file:line) | verdict | one-line why.

## Step 3 — Default vs approval (the exact test)

For every deviation you'd make while implementing, run these questions **in order**; the first YES decides:

1. **Does it read or write data that doesn't exist** (new field, new store, new cross-module linkage)? → **APPROVAL.** Never add schema unilaterally, even for a cosmetic slot — offer options: render a static placeholder, omit the slot, or approve the schema change. *(Calibration B: the design shows recurring tasks and logged time; tasks have no recurrence field and no session linkage. C: "+3 since yest." needs a daily snapshot store.)*
2. **Does it remove or change behavior that exists beyond the design?** Design silence is not prohibition — a feature the design doesn't show is not a feature the design forbids. → **APPROVAL** before deleting it. *(Calibration E: GTD inbox-processing actions exist in code but not in the prototype — keep, and ask.)*
3. **Do two authoritative design sources disagree** (component library vs screen prototype)? → **APPROVAL**, even if a previous pass already picked a winner — present the prior resolution as reversible. *(Calibration A: library `.pill` 11px/no-uppercase vs prototype pill 10px/uppercase.)*
4. **Does the design reference UI that is designed nowhere** (a hint pointing at an overlay no file shows)? → **APPROVAL** — building it means inventing design. *(Calibration G: "? all shortcuts" hint with no shortcut-sheet design.)*
5. **Does it touch shared shell/infrastructure beyond the audited screen** (router, global CSS, layout used by other screens)? → **APPROVAL**, flagged as a cross-cutting fix even when it's an outright bug. *(Calibration K: floating timer hardcoded `bottom: 22px` overlaps the hints bar; I: breadcrumb needs a router hook.)*
6. **Otherwise** — the design unambiguously shows the target state AND it's derivable from existing data AND it's reversible in one small commit → **DEFAULT-WITH-NOTICE**: do it, but list it in a "trivial alignments I'll do unless you object" section of the audit. Surfacing ≠ blocking; notice satisfies "no silent resolution" for this class. *(Calibration D: eyebrow "selected · 1 of 38" — position is derivable from the visible list; H: tab-count placement — pure presentation, target fully specified.)*
   - **Multi-state caveat:** "unambiguously shows" means a design pixel exists for **every state your change affects**. A prototype frozen at one moment shows one state; if your change also governs states the design never shows (calibration: title "This Week" — correct only when the anchor *is* the current week; the design never shows a navigated-away week), that's single-state evidence for multi-state behavior → list as a conflict **with a proposed mapping** for the unshown states, not a default.

Tie-breaker a less capable model can apply: **if you cannot point to a design pixel showing the end state, or cannot point to an existing data field feeding it — it is never a default.**

## Step 4 — Output format

ALWAYS structure the audit reply as:

1. **Headline finding** (one paragraph — especially the Step 0 result, since it reframes everything).
2. **Component verdict table** (Step 2).
3. **Tokens** — additions needed, or "none" with the verification result.
4. **Conflict list** — lettered (A, B, C…), each with: what disagrees, why it can't be defaulted (cite which Step 3 question fired), and 2–3 concrete options.
5. **Defaults-with-notice list** — one compact paragraph.
6. **Stop.** Name the 3–5 highest-leverage letters you need answered. Write no component code until the user replies.

During implementation (after approval): fix one component at a time; when resolving a listed conflict, leave the repo's conflict-log comment at the site so the next audit reads it as fidelity, not drift.
