# Implementation Plan: Information Pressure (with reply model selection)

**Branch**: `006-information-pressure` | **Date**: 2026-09-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-information-pressure/spec.md`, plus the planning
request "also add a selection that selects which model the AI is using to respond", which is now
User Story 4 and FR-015–FR-020 in the spec.

## Summary

A new `/settings` page, reached from a ⚙ button in the top bar, has two global controls for chat
replies:

- a 10-stop "information pressure" slider, grouped into five bands and defaulting to 8 (Detailed)
- a reply model selection, defaulting to "Default", the model the app is configured with

Both are stored as an append-only history in `setting_changes`, and the newest row wins. When an
AI reply is created, `insertPendingReply` writes the current level and resolved model onto the
message row. Generation reads them from that row, so a reply keeps its settings whatever happens
later.

The level becomes a length-guidance system block on reply requests only. The model becomes the
request's `model` (API) or `--model` (CLI). Summaries, definitions and suggestions are unchanged.
Each reply shows "Band · level · model" next to its AI tag.

## Technical Context

**Language/Version**: TypeScript 6, Node (unchanged)

**Primary Dependencies**: Next 16 App Router, React 19, Kysely and pg, zod 4, @anthropic-ai/sdk
0.128. No new dependencies.

**Storage**: PostgreSQL. Migration `0006_information_pressure.ts` adds the `setting_changes` table
(append-only, enforced by a trigger) and two nullable columns on `messages`
([data-model.md](./data-model.md)).

**Testing**: Vitest unit and integration tests and Playwright (fake provider):
`tests/unit/f6-*.test.ts`, `tests/integration/f6-settings.test.ts`,
`tests/e2e/f6-settings.spec.ts`, and extended constitution guards.

**Target Platform**: local web app on 127.0.0.1.

**Project Type**: a single Next.js web application.

**Performance Goals**: a settings change applies to the next reply with no reload (FR-005). Reading
the current settings adds one indexed query per reply insert.

**Constraints**:

- Replies only: no effect on summaries, definitions or suggestions.
- Settings history is append-only.
- Per-reply values are fixed at generation start.
- No DELETE or PATCH routes.

**Scale/Scope**: a single user; two settings; six model choices.

## Constitution Check

*Gate: checked before Phase 0 and re-checked after Phase 1.* Constitution version 1.0.1.

| Article | Result |
|---------|--------|
| I. User is final authority | PASS. Settings changes are `user_authored`, enforced by a CHECK. Replies stay `ai_suggested`. The length guidance defers to the person's explicit request in a message (research R1). |
| II. Additive growth | PASS. Nothing is deleted. `setting_changes` rejects UPDATE and DELETE in the database. Messages only gain nullable columns, set once at insert. No DELETE or PATCH routes. |
| III. Nothing invented ahead of evidence | N/A. No new AI-proposed structure. |
| IV. User-led exploration | PASS. There are no AI-initiated prompts. The level shapes replies the user asked for. |
| V. Compression preserves meaning | PASS. Brief levels ask for the direct answer, not a hollowed-out one. Summaries aren't affected (FR-007). |
| VI. History is data | PASS under the 1.0.1 clarification. The level and model are explicit instructions, not inferred personalization. Every change is kept with its time (FR-013, FR-020), and every reply keeps its own values (FR-012, FR-019). A guard test checks that only the settings module and reply creation read `setting_changes`, so nothing else is tuned from them. |

**Post-design re-check**: PASS. No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/006-information-pressure/
├── plan.md              # This file
├── research.md          # R1–R6
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── http-api.md      # GET/PUT /api/settings, Message fields
│   ├── ai-provider.md   # ReplyInput.pressureLevel/model, lengthGuidance, per-setup model use
│   └── ui.md            # top bar link, settings page, reply label
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/server/db/migrations/0006_information_pressure.ts   NEW
src/server/db/schema.ts                                 SettingChangesTable; messages columns
src/shared/models.ts                                    NEW REPLY_MODELS, modelLabel
src/shared/pressure.ts                                  NEW bands, default, bandOf
src/shared/schemas.ts                                   Message fields; SettingsResponse, SaveSettingsBody
src/server/settings/settings.ts                         NEW getSettings, saveSettings (append-only)
src/app/api/settings/route.ts                           NEW GET, PUT
src/server/ai/provider.ts                               ReplyInput.pressureLevel, model
src/server/ai/claudePrompts.ts                          lengthGuidance; reply builders only
src/server/ai/claude.ts, claudeCode.ts, fake.ts         model per reply; fallbacks per model
src/server/ai/index.ts                                  resolveReplyModel
src/server/messages/send.ts                             insertPendingReply writes level and model
src/server/messages/replyInput.ts                       reads them from the pending reply row
src/server/mappers.ts                                   toMessage adds the fields
src/lib/api.ts                                          getSettings, saveSettings
src/app/settings/page.tsx                               NEW
src/components/settings/SettingsForm.tsx                NEW slider, bands, model select
src/components/common/SettingsLink.tsx                  NEW ⚙ in the top bar
src/app/layout.tsx                                      add SettingsLink
src/components/chat/Message.tsx                         reply-meta label
src/app/globals.css                                     settings page, slider bands, reply-meta
tests/unit/f6-prompts.test.ts                           NEW lengthGuidance, reply vs other builders
tests/unit/f6-providers.test.ts                         NEW model args and fallbacks per setup
tests/integration/f6-settings.test.ts                   NEW API, history, per-reply recording
tests/integration/constitution.test.ts                  extended guards
tests/e2e/f6-settings.spec.ts                           NEW
```

**Structure Decision**: this follows the existing layout. Server logic goes in a new
`src/server/settings/` module, the page in `src/app/settings/`, and components in
`src/components/settings/`.

## Complexity Tracking

None.
