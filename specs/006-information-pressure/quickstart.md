# Quickstart & Validation: Information Pressure

Run as usual (`README.md`): `npm run db:migrate` (and `-- --test`), then `npm run dev`. The
migration is described in [data-model.md](./data-model.md). Automated tests use the fake provider
([contracts/ai-provider.md](./contracts/ai-provider.md)).

## Validation scenarios

These are checked by `tests/integration/f6-settings.test.ts`, `tests/unit/f6-*.test.ts` and
`tests/e2e/f6-settings.spec.ts`.

1. **Defaults (US1 AS2, US4 AS2, SC-004)**: on a fresh database, `GET /api/settings` returns
   `{ informationPressure: 8, replyModel: "default" }`. The Settings page shows "Level 8 ·
   Detailed" with "Default" selected.
2. **Level reaches the reply (US1, SC-001)**:
   - Set 2 and send a message. The fake's `lastReply.pressureLevel` is 2, and the request built by
     `buildReplyRequest` ends with the level 2 guidance.
   - Set 10 in the same browser session and send again. The new reply records 10, and nothing was
     reloaded.
3. **Everywhere (US2)**: at level 3, a root reply, a highlight branch reply, a `????` quick-branch
   reply, a retry and a regenerate all record 3.
4. **Fixed per reply (US3, FR-010)**:
   - Record a reply at 4, change to 9, and reload. The first reply still shows "Concise · 4" and
     the new one "Exhaustive · 9".
   - Change the level while a reply streams (fake `chunkDelayMs: 400`). The reply keeps its
     starting level.
   - Replies from before the migration show no label.
5. **Model (US4, SC-007)**:
   - Choose Claude Sonnet 5 and send. `lastReply.model === "claude-sonnet-5"`, and the label ends
     "Claude Sonnet 5".
   - Choose Default. The fake records `model: null` and the label shows "Default model".
   - Unit test: `ClaudeCodeProvider` args contain `--model claude-sonnet-5`. `ClaudeProvider`
     sends that model without fallbacks, and Opus 5 with fallbacks.
6. **No other effect (FR-007, FR-018, SC-005)**: the summary, define and suggest request builders
   produce byte-identical output at levels 1 and 10 and for every model choice. Summaries use
   `MODEL` whatever the choice.
7. **History and validation (FR-013, FR-020)**:
   - Three changes create three `setting_changes` rows, all `user_authored`. An unchanged PUT adds
     none.
   - UPDATE and DELETE on `setting_changes` are rejected by the database.
   - A PUT with level 11, 2.5 or `"gpt"` returns 422.
8. **Failed save (edge case)**: when the PUT returns 500 (the route is intercepted in Playwright),
   the slider goes back to the stored level and shows the alert.

## Manual check (SC-002)

With your real setup (`AI_PROVIDER=claude-code`), send the same 5 prompts at levels 1, 5 and 10,
and record the average word counts in `research.md` R1. Expect them to rise from band to band, with
level 10 at 3× or more of level 1.
