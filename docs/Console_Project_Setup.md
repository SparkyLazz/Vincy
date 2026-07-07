# Console — Project Setup & Workflow (Restart)

> Companion to `Console_Features_List.md`. This covers what exists today, what's missing, folder structure, and the build workflow for a clean restart.

---

## 1. Current state of the folder

**UPDATE:** the fidelity bundle and folder structure below have since been built — see `Console_Workflow.md` for what's actually in place now. This section is kept as the original before/after record.

**Was present at restart:**
- `Projects_Overview.md` — spec/vision doc
- `console_design_library_final.html` — 21-section design system reference
- `console_today_prototype.html`, `console_tasks_prototype.html`, `console_schedule_prototype.html`, `console_habits_prototype.html`, `console_finance_prototype.html`

**Was missing, now built:**
- `css/tokens.css`, `css/base.css`, `css/components.css` — extracted, conflicts resolved and logged (see `Console_Workflow.md`)
- `docs/visual_contract.md` — self-verification checklist
- `docs/phase_prompts/phase_1_foundation.md` — Phase 1 brief, ready to build against
- Folder structure (`css/`, `js/modules/*`, `docs/`, `prototypes/`) — scaffolded

**Still missing:**
- Actual app source code (`index.html`, `js/*` implementations) — Phase 1 is specced, not yet built
- Phase prompts for Phases 2–8
- Prototypes for Focus Sessions, Analytics, Insights, Settings — not designed yet

Treat this as a genuine restart: the design vision and 5 of 9 screens are already prototyped, the fidelity bundle now exists, but zero implementation code exists in this workspace yet.

---

## 2. Target folder structure

```
Rui's Productivity/
├── index.html
├── css/
│   ├── tokens.css        ← extract from design library
│   ├── base.css          ← extract from design library
│   └── components.css    ← extract from design library
├── js/
│   ├── app.js             (shell: routing, theme, cmd palette)
│   ├── db.js               (IndexedDB setup, 13 stores)
│   ├── modules/
│   │   ├── today/
│   │   ├── tasks/
│   │   ├── schedule/
│   │   ├── habits/
│   │   ├── finance/
│   │   ├── focus/
│   │   ├── analytics/
│   │   ├── insights/
│   │   └── settings/
│   └── lib/                (shared helpers: date parsing, NLP capture, chart rendering)
├── fonts/                  (self-hosted .woff2)
├── docs/
│   ├── Projects_Overview.md
│   ├── Console_Features_List.md
│   ├── Console_Project_Setup.md
│   ├── visual_contract.md
│   └── phase_prompts/
│       ├── phase_1_foundation.md
│       ├── phase_2_tasks.md
│       └── ... phase_8
└── prototypes/             (existing 6 HTML files, moved here for reference)
```

Each `js/modules/<name>/` follows the `init(container)` / `destroy()` pattern from the overview — keeps modules decoupled and swappable.

---

## 3. Step 0 — Extract the fidelity bundle (do this before Phase 1)

`console_design_library_final.html` is the single source of truth for styling. Before any implementation:

1. Pull all CSS custom properties (color tokens, both themes, font declarations) into `css/tokens.css`
2. Pull shell/layout CSS (sidebar, topbar, floating timer, kbd hints, typography classes) into `css/base.css`
3. Pull every reusable component style (cards, pills, buttons, charts, tables) into `css/components.css`
4. Write `visual_contract.md` — a short checklist Claude self-verifies against after each phase (e.g. "three fonts only," "two-voice stat rule respected," "module color used correctly," "no streak language anywhere")

This bundle gets reused, unchanged, across every phase — it's what keeps 9 screens visually consistent without re-deriving styles each time.

---

## 4. Build phase order

| # | Phase | Depends on | Needs prototype first? |
|---|---|---|---|
| 1 | Foundation — shell, IndexedDB (13 stores), routing, theme, cmd palette, Today dashboard | Step 0 bundle | No — Today prototype exists |
| 2 | Tasks — NLP parser, 8 views, subtasks, recurring, keyboard nav | Phase 1 | No — prototype exists |
| 3 | Schedule — 5 views, strict typing, planned-vs-actual, drag reschedule | Phase 1 | No — prototype exists |
| 4 | Habits — Atomic framework UI, consistency %, 4-state logging | Phase 1 | No — prototype exists |
| 5 | Finance — multi-currency, envelopes, subscriptions, cost-per-focus-hour | Phase 1 | No — prototype exists |
| 6 | Focus Sessions — 3 timer modes, cross-module triggers | Phases 2, 3, 4 (links into all three) | **Yes** — not designed |
| 7 | Analytics + Insights — 11 chart views, 10 detectors | Phases 2–6 (reads their data) | **Yes** — not designed |
| 8 | Settings + polish — full cmd palette search, import/export, shortcuts | All prior phases | **Yes** — not designed |

Recommended order given 3 phases still need prototypes: build Phases 1–5 first (everything already has a visual reference), then design Focus/Analytics/Insights/Settings prototypes, then build Phases 6–8. This matches the original plan's own recommendation.

---

## 5. Per-phase workflow

Since this is now a single working session rather than a two-instance (Opus-designs / Sonnet-builds) handoff, each phase follows one loop:

1. **Spec** — write a short phase brief: scope, data model touched, views + behavior, explicit acceptance criteria, explicit exclusions (what NOT to build yet)
2. **Build** — implement against the brief, pulling all styling from `css/tokens.css` + `base.css` + `components.css`. Never inline one-off styles — if a component is missing, add it to `components.css`
3. **Self-verify** — check the result against `visual_contract.md` and the phase's acceptance criteria before calling it done
4. **Log drift** — if something didn't match the prototype or contract, note it so the next phase's brief accounts for it
5. **Move to next phase**

This keeps the discipline of the original two-instance process (spec → build → review against criteria) without needing a second chat.

---

## 6. Immediate next actions

1. Confirm this setup (folder structure, phase order) works for you
2. Extract the fidelity bundle (Step 0) from `console_design_library_final.html`
3. Write the Phase 1 (Foundation) brief and start building — this unblocks every other module
4. Move existing prototype HTMLs into `/prototypes` for reference

---

## 7. Non-negotiables carried over from the original spec

- No framework, no build step, no CDN in production
- IndexedDB, all 13 stores defined at Phase 1 — no migrations later
- Hash-based routing, must work from `file://`
- Three fonts only, two-voice stat rule, no streaks, strict event typing, YNAB envelopes, GTD inbox-first
