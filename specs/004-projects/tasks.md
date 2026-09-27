---
description: "Task list for Projects"
---

# Tasks: Projects

**Input**: [spec.md](./spec.md) and [plan.md](./plan.md). Tests are included, as in earlier
features.

## Phase 1: Setup

- [X] T001 Create migration `src/server/db/migrations/0004_projects.ts` per the plan's data model,
  and add `ProjectsTable` plus the `project_id` columns to `src/server/db/schema.ts`
- [X] T002 Run the migration on the dev and test databases. Add `projects` to the TRUNCATE lists in
  `tests/integration/setup.ts` and `tests/e2e/helpers.ts`. Make `scripts/seed-large.ts` create a
  project and seed into it

## Phase 2: Foundational

- [X] T003 Add `Project` and the response schemas to `src/shared/schemas.ts`
- [X] T004 Create `src/server/projects/projects.ts` with:
  - `resolveProject(cookieId)`: the cookie's project if it is active, else the oldest active one,
    creating "My first project" if none exists;
  - `projectFromRequest(req)`;
  - `listProjects`, `createProject`, `openProject`, `trashProject`, `restoreProject`;
  - a `projectCookie(id)` header helper.

## Phase 3: User Story 1 — Create and open projects (P1)

- [X] T005 [P] [US1] Integration tests in `tests/integration/f4-projects.test.ts`:
  - the default project is created on demand;
  - create returns 201 and sets the cookie;
  - blank names return 422;
  - the forest and new trees are scoped by the cookie;
  - new trees start at x = 0 in each project;
  - the same term captured in two projects gives two definitions;
  - the list and index are scoped;
  - an unknown or trashed cookie falls back.
- [X] T006 [US1] Scope `getForest(projectId)` and `createRootTree(projectId)`, and their routes, in
  `src/server/forest/forest.ts`, `src/server/forest/trees.ts`, `src/app/api/forest/route.ts` and
  `src/app/api/trees/route.ts`
- [X] T007 [US1] Scope definitions: capture takes the project from the source node, with the
  conflict key `(project_id, term_key)`; `listDefinitions(projectId)` and `termIndex(projectId)`;
  update `src/app/api/definitions/route.ts`
- [X] T008 [US1] Routes `src/app/api/projects/route.ts` (GET, POST) and
  `src/app/api/projects/[id]/open/route.ts`. Scope the home page `src/app/page.tsx` by project
- [X] T009 [US1] Top-bar `src/components/common/ProjectMenu.tsx`: the current name; a list to open
  from; a "New project" inline form. Do a full page load after any switch. Add `api` methods and
  styles

## Phase 4: User Story 2 — Trash and restore (P2)

- [X] T010 [P] [US2] Integration tests: trash hides the project and keeps its data; trashing the
  open project moves the cookie, and creates "Untitled project" if it was the last; restore
  brings it back; open on a trashed project returns 409; feedback links still resolve
- [X] T011 [US2] Routes `src/app/api/projects/[id]/trash/route.ts` and `.../restore/route.ts`
- [X] T012 [US2] ProjectMenu: "Move to trash" with an inline confirmation, and a Trash section with
  Restore

## Phase 5: Polish

- [X] T013 [P] Playwright `tests/e2e/f4-projects.spec.ts`: create B, see an empty map, start a
  conversation, switch to A and back, trash B, restore it
- [X] T014 [P] Add a "Projects" note to README.md
- [X] T015 Full run: typecheck, lint, `npm test`, `npm run test:e2e`
