# Feature Specification: Projects

**Feature Branch**: `004-projects`

**Created**: 2026-09-27

**Status**: Draft

**Depends on**: Features 1–3.

## Clarifications

### Session 2026-09-27

- Q: What is a project? → A: One map (forest): its own trees, conversations and definitions.
- Q: What should "Save" do? → A: Nothing new. Everything already saves automatically, so there
  is no Save action.
- Q: What does Delete do? → A: It moves a project to the trash. The project is hidden from the
  list but kept in full and can be restored. Nothing is removed.
- Q: Are definitions per project or shared? → A: Per project.

**Input**: "Add the ability to open, save and delete projects, which are graphs in this case.
Very basic."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create and open projects (Priority: P1)

The user keeps separate maps for separate subjects. From a project menu in the top bar they create
a new, named project, which opens empty. Later they switch back to an earlier project and find
its map, conversations and definitions exactly as they left them.

**Independent Test**: Create project B while in A. B's map and Definitions tab are empty. Start a
conversation in B, open A, and A shows only its own trees. Open B again and its conversation is
there.

**Acceptance Scenarios**:

1. **Given** existing data from before this feature, **When** the app first runs, **Then** it all
   belongs to one project named "My first project".
2. **Given** the project menu, **When** the user creates a project with a name, **Then** it becomes
   the open project and shows an empty map.
3. **Given** a blank or whitespace-only name, **When** the user tries to create a project,
   **Then** nothing is created.
4. **Given** two projects, **When** the user opens one, **Then** the map, Chat and Definitions
   show only that project's trees, conversations and definitions.
5. **Given** the same term collected in two projects, **When** each project's Definitions tab is
   viewed, **Then** each has its own entry.
6. **Given** a project was open when the app was closed, **When** the app is reopened, **Then** the
   same project is open.

### User Story 2 - Move a project to the trash and restore it (Priority: P2)

The user no longer wants a project in their list, so they move it to the trash, which asks for
confirmation first. If they change their mind, they restore it from the trash.

**Independent Test**: Trash project B while it is open. The app switches to another project and B
disappears from the list. Restore B from the trash and its content is intact.

**Acceptance Scenarios**:

1. **Given** a project, **When** the user moves it to the trash and confirms, **Then** it leaves
   the project list and appears in the trash, with all its data kept.
2. **Given** the open project is trashed, **When** that completes, **Then** another project opens.
   If none is left, a new empty project named "Untitled project" is created and opened.
3. **Given** a trashed project, **When** the user restores it, **Then** it returns to the list with
   everything intact.
4. **Given** a feedback item whose conversation belongs to a trashed project, **When** the
   feedback is viewed, **Then** its link still works.

### Edge Cases

- A stored "open project" that no longer exists or is in the trash falls back to the oldest active
  project.
- A conversation URL from another project still opens that conversation, since conversations are
  addressable by id.
- Feedback stays global. It is about the app, not a project.

## Requirements *(mandatory)*

- **FR-001**: The system MUST group trees, and definitions, into projects. Every tree belongs to
  exactly one project.
- **FR-002**: Existing data MUST be moved into a project named "My first project". When no project
  exists at all, one MUST be created on first use.
- **FR-003**: The user MUST be able to create a project with a name of 1–80 characters after
  trimming. The new project becomes the open one.
- **FR-004**: The user MUST be able to open any active project. The open project MUST be
  remembered in this browser across restarts.
- **FR-005**: The map, the home redirect, new conversations and the Definitions tab (list and
  underlined terms) MUST be scoped to the open project.
- **FR-006**: A definition's term MUST be unique within its project, not across projects.
- **FR-007**: The user MUST be able to move a project to the trash after an explicit confirmation.
  A trashed project is hidden, not deleted. None of its data is removed.
- **FR-008**: The user MUST be able to restore a trashed project.
- **FR-009**: Trashing the open project MUST open another active project, creating
  "Untitled project" if none remains.
- **FR-010**: No project action may delete data (Constitution Article II), and no AI is involved
  in any project action.

## Success Criteria *(mandatory)*

- **SC-001**: Switching projects shows the other project's map in under 1 s on the 500-node seed.
- **SC-002**: 100% of trees, conversations and definitions are unchanged after a trash-and-restore
  cycle.
- **SC-003**: After the migration, all pre-existing data is visible in "My first project" with
  nothing lost.

## Assumptions

- No rename in v1. The name is set when the project is created.
- There is no permanent deletion. The trash only ever hides projects, so Article II needs no
  exception.
- One user in one browser: the open project is a per-browser preference kept in a cookie.
