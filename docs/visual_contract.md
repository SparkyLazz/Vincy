# Console — Visual Contract

> Self-verification checklist. Run through every item after building or changing a screen, before marking a phase done. Contract wins over prototype if they ever disagree (the contract is where a real conflict already got a deliberate answer — see `Console_Workflow.md`).

## 1. Source of styling

- [ ] `tokens.css`, `base.css`, `components.css` are loaded in `<head>` in that order, copied verbatim into `css/` — not re-derived or retyped.
- [ ] No inline `style="..."` attributes anywhere except values that are genuinely dynamic per-instance (e.g. a computed progress-bar width, a chart's data-driven dimensions).
- [ ] No hardcoded hex colors, px font sizes, or font-family strings in JS or HTML — everything traces back to a CSS variable or an existing class.
- [ ] A component that doesn't exist yet was added to `components.css`, not inlined.

## 2. Typography — three fonts, zero exceptions

- [ ] Source Serif 4 only for: page titles, section titles, annotated-stat values, italic annotations, the brand mark.
- [ ] Inter only for: body copy, buttons, hero-stat numbers (weight 800, letter-spacing -0.035em).
- [ ] JetBrains Mono only for: eyebrows, meta rows, pill labels, keyboard hints, timestamps, tabular data.
- [ ] No other font family appears anywhere.

## 3. Two-voice stat rule

- [ ] Hero stats (Inter 800 huge number + mono uppercase caption) are used only for the single biggest number on a screen.
- [ ] Every other stat uses the annotated-stat pattern (serif 700 number + italic serif annotation below).
- [ ] The two patterns are never mixed on the same stat.

## 4. Color and module identity

- [ ] Paper/ink/accent values come from `tokens.css`, both light and dark themes checked.
- [ ] Module color is correct: teal = habits, blue = tasks, amber = schedule, plum = focus, rose = finance.
- [ ] Dark mode was actually toggled and checked, not just assumed to work because variables exist.

## 5. Locked philosophical decisions (do not erode)

- [ ] Habits: no streaks anywhere, only rolling 30-day consistency %.
- [ ] Schedule/Focus: only the 8 preset event types / preset session types — no free-text categories introduced.
- [ ] Finance: YNAB-style envelope model (To-Be-Budgeted pool), not a generic budget list.
- [ ] Tasks: capture flows through the GTD inbox-first pattern, not a direct-add-to-list shortcut.
- [ ] No student/grade/academic framing anywhere in copy or data model.
- [ ] Fully offline — no fetch to an external API for app data, no accounts, no sync.

## 6. Structural fidelity

- [ ] The built screen's DOM structure and class names match the source prototype for that view (verified by opening both side by side), not just "looks similar at a glance."
- [ ] Any class shared with another already-built module was checked against that module's usage — no silent duplicate/conflicting definition (this is exactly how `.card`/`.pill`/`.priority`/`.segmented`/`.breadcrumb` broke during bundle extraction; see `Console_Workflow.md`).
- [ ] Any animation (`@keyframes`) referenced by a class actually has its keyframe definition present in the loaded CSS.

## 7. Interaction and data

- [ ] IndexedDB store(s) touched by this phase match the schema in `Console_Features_List.md` — no ad hoc extra fields without updating that doc.
- [ ] Keyboard shortcuts specified for this module are wired and don't collide with shortcuts from an already-built module.
- [ ] Routing works from `file://` (hash-based, no server-relative paths).

## 8. Before marking the phase done

- [ ] Every acceptance criterion in the phase brief is met — not "mostly."
- [ ] Any known gap or deviation is written down (in the CSS file if it's a styling decision, in `Console_Workflow.md` if it's structural) rather than left unstated.
- [ ] The screen was actually opened and clicked through, both themes, not just read as code.
