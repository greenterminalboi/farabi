# Implementation Plan: Projects

**Branch**: `004-projects` | **Date**: 2026-09-27 | **Spec**: [spec.md](./spec.md)

This is a short plan, as agreed: research, data model and contracts are condensed here.

## Summary

A new `projects` table. Trees and definitions each get a `project_id`. The open project is a
`farabi_project` cookie, which API routes and the home page read. Any page reads it through a
single server helper, `resolveProject()`. A project menu in the top bar lists, creates, opens,
trashes and restores projects. After a switch the client does a full page load, so every client
store (map, definitions, last node) starts clean.

## Technical Context

- **Stack**: unchanged from Features 1–3; no new dependencies.
- **Storage**: migration `0004_projects.ts`.
- **Testing**: Vitest integration tests and one Playwright spec, `f4-projects.spec.ts`.
- **Constraints**:
  - nothing is deleted (trash is a hidden flag);
  - no DELETE or PATCH routes;
  - feedback stays global.

## Decisions

- **D1. Open project in a cookie, not the database.**
  - It is a per-browser view preference, like the scroll position.
  - Route handlers read it from the request's `cookie` header; the home page reads it with
    `cookies()`.
  - When the cookie is missing, unknown or points to a trashed project, the oldest active project
    is used, and one is created if none exists (FR-002).
- **D2. Full page load after a switch.**
  - The map renderer, term index and `lastNodeId` are client state from the old project.
  - `window.location.assign("/")` resets them all without per-store reset code.
- **D3. Trash is `projects.trashed_at`.**
  - Restoring sets it back to NULL.
  - Trash state is a display preference on the project, not part of the user's learning history
    (Article VI), so it lives in a plain column.
- **D4. Definitions per project.**
  - `definitions.project_id` is filled from the source node's tree.
  - The unique key changes from `term_key` to `(project_id, term_key)`.
  - A capture takes the project from the source node, not the cookie, so a term always lands in the
    project its conversation belongs to.
- **D5. New trees start at x = 0 in each project.** Origin allocation looks only at the project's
  own trees.

## Data model (`0004_projects.ts`)

- `projects`:
  - `id uuid PK`
  - `name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80)`
  - `created_at timestamptz DEFAULT now()`
  - `trashed_at timestamptz NULL`
- `trees.project_id uuid NOT NULL REFERENCES projects ON DELETE RESTRICT`, indexed.
- `definitions.project_id uuid NOT NULL REFERENCES projects ON DELETE RESTRICT`, with
  `UNIQUE (project_id, term_key)` replacing `definitions_term_key_key`.
- **Backfill**: if any tree exists, insert "My first project" and assign every tree to it, and
  each definition to its source node's project. Then set the columns NOT NULL.

## HTTP API

The same rules apply: local requests only, `{ error }` bodies, and POST for every write.

| Route | Result |
|-------|--------|
| `GET /api/projects` | `{ projects, trashed, currentId }`; active projects oldest first, trashed ones by trash time, newest first |
| `POST /api/projects` `{ name }` | 201 `{ project }`; sets the cookie to the new project |
| `POST /api/projects/{id}/open` | 200 `{ project }`; sets the cookie. 404 if unknown, 409 `trashed` if in the trash |
| `POST /api/projects/{id}/trash` | 200 `{ currentId }`; if the trashed project was open, the cookie moves to another project (FR-009) |
| `POST /api/projects/{id}/restore` | 200 `{ project }` |

The following now use the open project: `GET /api/forest`, `POST /api/trees`,
`GET /api/definitions` (list and `?index=1`), and the home page.

`Project` is `{ id, name, createdAt, trashedAt }`.

## Constitution Check

| Article | Result |
|---------|--------|
| I. User is final authority | PASS: no AI involvement in any project action |
| II. Additive growth | PASS: the trash hides and never deletes; no DELETE routes; nodes and parents are untouched |
| III. Nothing invented ahead of evidence | PASS: not applicable |
| IV. User-led exploration | PASS: nothing is proposed by the AI |
| V. Compression preserves meaning | PASS: not applicable |
| VI. History is data | PASS: every tree, conversation and history is kept; trash is a plain display flag (D3) |

## Files

```text
src/server/db/migrations/0004_projects.ts    NEW
src/server/db/schema.ts                      projects table; project_id columns
src/server/projects/projects.ts              NEW list/create/open/trash/restore, resolveProject
src/app/api/projects/…                       NEW 4 route files
src/server/forest/forest.ts, trees.ts        scope by project
src/server/definitions/capture.ts, list.ts   scope by project
src/app/api/forest, trees, definitions       pass the project from the cookie
src/app/page.tsx                             latest node in the open project
src/components/common/ProjectMenu.tsx        NEW top-bar menu
scripts/seed-large.ts                        seeds into a project
tests/integration/f4-projects.test.ts        NEW
tests/e2e/f4-projects.spec.ts                NEW
```
