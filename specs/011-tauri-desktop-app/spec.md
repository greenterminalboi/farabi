# Feature Specification: Farabi as a Native Desktop App

**Feature Branch**: `011-tauri-desktop-app`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "Farabi becomes a native desktop app on macOS and Windows built with
Tauri, replacing the web app entirely (no more browser/localhost web app). Zero-setup install: the
user installs Farabi and nothing else (no Postgres, Node, or other runtime to install separately);
data is stored locally. The app should behave the same as the current web app (canvas, chat,
projects, feedback, etc.)."

## Clarifications

### Session 2026-10-07

- Q: Should the Claude Code provider stay? → A: Yes, as an optional provider. The owner needs
  replies billed to their Claude subscription. It is available only when Claude Code is found on
  the machine; otherwise the app offers the API provider (FR-012, FR-012a).
- Q: Who installs the app? → A: Only the owner, for now. Unsigned builds are acceptable; signing,
  notarization and automatic updates are out of scope (FR-021).
- Q: How does this relate to feature 010 (v0.2)? → A: Built in parallel. The desktop shell and
  local storage are built now, alongside 010, and 010's remaining work must land in and run in the
  desktop app (FR-024, FR-025).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install and use Farabi with nothing else installed (Priority: P1)

A person on a clean macOS or Windows machine downloads one Farabi installer and runs it. Farabi
appears in the Applications folder or Start menu like any other app. They open it, enter how
Farabi should reach Claude, and start their first conversation. They never open a terminal or a
browser, install a database or runtime, or edit a configuration file.

**Why this priority**: This is the whole feature. Today Farabi needs Node, Docker, Postgres, a
migration command and a `.env` file before it runs. Removing that is the goal.

**Independent Test**: On a fresh macOS machine and a fresh Windows machine with no developer tools,
install from the installer and send a message. It can be checked with the fake AI provider, so no
account is needed.

**Acceptance Scenarios**:

1. **Given** a machine with no Node, Docker, Postgres or Claude Code, **When** the user runs the
   installer and opens Farabi, **Then** the app opens in its own window and is ready to use, with
   no other prompts to install anything.
2. **Given** a first launch, **When** the app opens, **Then** it creates its own local data store
   with no user action, and the user lands on an empty project ready for a first message.
3. **Given** the app is open, **When** the user looks for a browser tab, local web address or
   terminal window, **Then** none exists. Farabi is reachable only through its own window.
4. **Given** the user has entered an API key in Settings, **When** they send a message, **Then**
   the reply streams in just as it does in the web app.

---

### User Story 2 - Everything works as it does in the web app (Priority: P1)

A user who knows the web app opens the desktop app and finds the same Farabi: the same canvas,
conversations, branching, definitions, suggestions, projects, parked branches, kind settings,
settings and feedback, with the same behavior.

**Why this priority**: The web app is being retired. Anything that does not work in the desktop
app is lost.

**Independent Test**: Run the existing end-to-end scenarios against the desktop app on both
operating systems. Each one passes with the same expected outcome.

**Acceptance Scenarios**:

1. **Given** any user-facing capability present in the web app at the point of cut-over, **When**
   the user performs it in the desktop app, **Then** the outcome is the same.
2. **Given** a large project (the 5,000-element scale proof), **When** the user pans and zooms,
   **Then** the canvas meets the same smoothness targets the web app meets.
3. **Given** text anywhere in the app, **When** the user selects and copies it, **Then** selection
   and clipboard behave as they do in the web app, with the platform's normal shortcuts (⌘ on
   macOS, Ctrl on Windows).

---

### User Story 3 - Keep my existing data (Priority: P1)

A user who already has projects in the web app's database moves them into the desktop app once.
Nothing is lost, including provenance states (ai-suggested, user-confirmed, user-authored),
history and feedback.

**Why this priority**: The owner's existing work lives in the web app's database. Retiring the web
app without bringing it across would destroy it.

**Independent Test**: Import a copy of a populated web-app database and compare every record and
its provenance state with the source.

**Acceptance Scenarios**:

1. **Given** an existing web-app database, **When** the user runs the one-time import, **Then**
   every project, node, edge, definition, setting and feedback item appears in the desktop app,
   and each item keeps its provenance state and timestamps.
2. **Given** an import that fails partway, **When** it stops, **Then** the desktop app's data is
   left as it was before the import began, and the user is told what failed.
3. **Given** a completed import, **When** the user runs it again, **Then** nothing is duplicated.
   The user is told the data is already present.

---

### User Story 4 - Configure Farabi inside the app (Priority: P2)

Everything that today lives in `.env.local` (AI provider, API key, model, summary trigger,
feedback location) is set in the app's Settings. The API key is held securely by the operating
system.

**Why this priority**: Zero setup means no configuration files. It comes after P1 because a
sensible default (the fake provider, or a prompt for a key) makes the app usable before it.

**Independent Test**: Change the provider and model in Settings, restart the app, and confirm the
choices persist and take effect. Confirm the key is not stored in plain text in Farabi's data.

**Acceptance Scenarios**:

1. **Given** no API key is set, **When** the user sends a message, **Then** they are told plainly
   that a key is needed and taken to the place to enter it, and their message is not lost.
2. **Given** an API key is saved, **When** the user inspects Farabi's data files, **Then** the key
   does not appear in them.
3. **Given** a setting is changed, **When** the app restarts, **Then** the setting is kept.

---

### User Story 5 - Feedback still reaches the development loop (Priority: P2)

The owner logs feedback in the app, with screenshots, as today. The exported feedback list and its
attachments land in a folder the owner chooses (for development, the repo's `feedback/` folder), so
the existing "read FEEDBACK.md, mark addressed" workflow keeps working.

**Why this priority**: Feedback is how Farabi is steered. The workflow in `CLAUDE.md` depends on
the export file.

**Independent Test**: Point the feedback folder at a directory, log an item with a screenshot,
and confirm the export and attachment appear there. Mark it addressed from the command line and
confirm the app shows it as addressed.

**Acceptance Scenarios**:

1. **Given** a feedback folder is chosen, **When** the user logs or changes feedback, **Then** the
   export is regenerated in that folder with its screenshots.
2. **Given** an item is marked addressed outside the app, **When** the app is open, **Then** the
   item shows as addressed, and only the user can confirm or reopen it.

---

### User Story 6 - Updates and installs feel like a normal app (Priority: P3)

The app behaves like a native citizen of each platform. Only one copy runs at a time, the window
remembers its size and position, and the user can get a new version without losing data.

**Why this priority**: These are quality-of-life details. The core value is delivered without them.

**Independent Test**: Install version N, create data, install version N+1, and confirm data and
window state survive. Launch the app twice and confirm only one window opens.

**Acceptance Scenarios**:

1. **Given** Farabi is open, **When** the user launches it again, **Then** the existing window is
   focused and no second copy starts.
2. **Given** a newer version is installed over an older one, **When** it opens, **Then** all data
   is present and any data changes needed by the new version are applied automatically, after a
   backup is taken.
3. **Given** the user uninstalls Farabi, **When** it is removed, **Then** their data is kept unless
   they choose to delete it.

---

### Edge Cases

- **No network**: the app opens and every existing project can be browsed and edited. Only actions
  that need the AI fail, each with a clear message, and no user input is lost.
- **Reply interrupted**: the network drops or the app is closed while a reply streams. On next
  launch the partial reply is kept as it is in the web app today (Stop keeps what has arrived).
- **Quit during a write**: the app is force-quit or the machine loses power. On next launch the
  data is consistent, with no half-written records.
- **Disk full / no write access**: the app tells the user it cannot save and does not pretend the
  save succeeded.
- **Data from a newer version**: an older app opening data written by a newer version refuses to
  open it and says why, rather than damaging it.
- **Feedback folder missing**: the chosen folder is deleted or on an unplugged drive. Feedback is
  still saved in the app, and the user is told the export could not be written.
- **Gatekeeper / SmartScreen**: the operating system warns about the unsigned installer. The steps
  to open it anyway are documented (see FR-021).
- **High-DPI and multiple monitors**: the window moves between screens with different scaling and
  the canvas and text stay sharp and correctly positioned.
- **Claude Code provider without Claude Code**: if Claude Code is uninstalled, moved or signed out
  after being selected, the app says which, offers the API provider, and keeps the user's message
  (see FR-012a).

## Requirements *(mandatory)*

### Functional Requirements

**Packaging and platforms**

- **FR-001**: Farabi MUST ship as an installable desktop application for macOS (Apple Silicon and
  Intel) and Windows (64-bit, Windows 10 and later).
- **FR-002**: The installed app MUST run without the user installing any other software: no
  database server, language runtime, container tool or command-line tool.
- **FR-003**: The app MUST run in its own native window. It MUST NOT require or open a web
  browser, and MUST NOT expose its interface or data on a network address that other programs or
  machines can reach.
- **FR-004**: The browser-based web app MUST be retired. After cut-over there is one way to run
  Farabi, the desktop app, and the development setup builds and runs that app.
- **FR-005**: Only one instance of the app MAY run at a time. A second launch MUST focus the
  existing window.
- **FR-006**: The app MUST remember window size, position and maximized state between launches,
  and recover sensibly if the saved position is off-screen.

**Behavior parity**

- **FR-007**: Every user-facing capability of the web app at the point of cut-over MUST work in the
  desktop app with the same behavior, including streaming replies and Stop.
- **FR-008**: The canvas MUST meet the web app's performance targets (feature 010, SC-005 and
  SC-008) on both operating systems on the reference hardware.
- **FR-009**: Text selection, copy, paste, keyboard shortcuts and dyslexia-friendly font support
  MUST work as in the web app, using each platform's standard modifier key.
- **FR-010**: All constitution guarantees MUST be preserved through the change. In particular,
  the provenance state of every item (Article I) and the full build history (Article VI) MUST
  survive storage, import and upgrade unchanged.

**Configuration and secrets**

- **FR-011**: Every setting that is configured today through environment variables (AI provider,
  model, summary trigger, feedback location) MUST be configurable in the app's Settings, with the
  same defaults.
- **FR-012**: The app MUST support three providers: the Claude API, the deterministic fake, and
  Claude Code. Claude Code is optional. It is offered only when a Claude Code installation is found
  on the machine, and replies through it are billed to the user's Claude subscription, as today.
- **FR-012a**: The Claude Code provider MUST keep today's safeguards: tools disabled, run in an
  empty folder, and any API key removed from its environment. It MUST find Claude Code in its
  usual install locations even though a desktop app does not inherit the user's terminal setup.
  If Claude Code is missing or not signed in, the app MUST say which, and offer the API provider.
- **FR-013**: The API key MUST be stored in the operating system's secure credential store, never
  in Farabi's data files, logs or feedback exports, and MUST be removable by the user.
- **FR-014**: When an AI action is attempted without a usable provider configuration, the app MUST
  explain what is missing, take the user to the setting, and keep any text they had written.

**Data**

- **FR-015**: All user data MUST be stored locally on the user's machine, in the platform's
  standard location for application data, created automatically on first launch.
- **FR-016**: Data writes MUST be durable and atomic. A crash or force-quit MUST never leave
  partially written records.
- **FR-017**: The app MUST provide a one-time import of an existing web-app database. The import
  MUST bring every record across with its provenance state and timestamps. It MUST be
  all-or-nothing and safe to repeat.
- **FR-018**: When a new version needs to change stored data, it MUST take a backup first, apply
  the change automatically, and refuse to open data written by a newer version.
- **FR-019**: The user MUST be able to see where their data is kept and open that location from
  the app.

**Feedback loop**

- **FR-020**: Feedback logging, screenshots and the generated export MUST work as today. The export
  folder MUST be user-selectable, and the command-line "mark addressed" step MUST keep working
  against the desktop app's data. Only the user can confirm or reopen an item.

**Distribution**

- **FR-021**: The app is distributed only to the owner, for now. Builds MAY be unsigned. The
  one-time operating-system warning on first launch (Gatekeeper on macOS, SmartScreen on Windows)
  is acceptable, and the steps past it MUST be documented. Code signing, notarization, automatic
  updates and a public download page are out of scope.
- **FR-022**: Installing a newer version over an older one MUST keep all user data and settings.
- **FR-023**: Uninstalling MUST NOT delete user data unless the user explicitly chooses to.

**Sequencing**

- **FR-024**: This feature is built in parallel with feature 010 (v0.2). Neither waits for the
  other. Work for 010 that lands while this feature is under way MUST also run in the desktop app,
  so "parity" (FR-007) means parity with the app as it stands at cut-over, not as it stood when
  this feature began.
- **FR-025**: Until cut-over, the web app MUST keep working so 010 can continue to be developed and
  tested. Cut-over (FR-004) happens once the desktop app passes every end-to-end scenario on both
  operating systems (SC-004). The web app and its database server setup are removed at that
  point, not before.

### Key Entities

- **Local data store**: the single on-device home for everything Farabi keeps: projects, the message
  graph, definitions, kind settings, settings, feedback and attachments. It carries a schema version
  so upgrades and downgrades can be detected.
- **App settings**: user-chosen configuration that used to live in environment variables. The API
  key is not here; it is in the OS credential store.
- **Credential**: the Claude API key, held by the OS credential store and referenced by name only.
- **Import run**: a record of a one-time import from the web-app database: source, start and end,
  outcome, and counts per record type, so a repeat run can be detected.
- **Data backup**: a copy of the local data store taken before an upgrade or import, with the
  version it came from.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a clean macOS machine and a clean Windows machine, a person goes from downloaded
  installer to first reply in under 3 minutes, installing nothing else and editing no files.
- **SC-002**: The installer download is under 100 MB on each platform.
- **SC-003**: From a cold start, the app is ready for input within 3 seconds on the reference
  hardware. An existing project's canvas opens within the web app's existing 1-second target.
- **SC-004**: 100% of the web app's end-to-end scenarios at cut-over pass against the desktop app on
  both operating systems.
- **SC-005**: Panning and zooming a 5,000-element project holds a p95 frame time of 16.7 ms or less
  on both operating systems, matching the web app's target.
- **SC-006**: Importing the owner's existing database brings across 100% of records, with zero
  differences in content, provenance state or timestamps when compared against the source.
- **SC-007**: Across 50 forced quits during active writing and streaming, the data store opens
  consistently every time, with zero lost confirmed records.
- **SC-008**: The API key is found in zero files under the app's data folder, logs or feedback
  exports.
- **SC-009**: After the change, the steps to run Farabi in development are "install dependencies,
  start the app". No database container, migration command or environment file is required.

## Assumptions

- **Platform choice is the owner's**: the desktop shell is Tauri, as decided by the owner. The plan
  decides how the existing server-side work (AI calls, storage, feedback export) runs inside it,
  within FR-002 (no separately installed runtime).
- **Storage changes**: the current external database server conflicts with FR-002, so local storage
  is expected to change to an embedded store. The plan chooses it, and the import (FR-017) is the
  bridge for existing data.
- **Zero setup applies to Farabi itself**: the optional Claude Code provider relies on the user's
  own Claude Code installation. That is not an exception to FR-002, because the app is fully usable
  without it through the API or fake provider.
- **Single user, single device**: Farabi stays a personal tool. There is no sync, accounts or
  multi-device support in this feature.
- **Linux, mobile and touch** are out of scope.
- **Reference hardware**: the owner's current Mac, plus a mid-range Windows 10/11 laptop with
  integrated graphics, both with WebGL2-capable GPUs. Performance criteria are measured there.
- **The AI still runs in the cloud**: replies need a network connection and a provider account.
  "Zero setup" means no software installation, not no account.
- **Existing defaults carry over**: the fake provider is the default until a key is entered, and
  the reply detail and model settings keep their current defaults.
- **Automated testing**: end-to-end tests run against the desktop app. Test tooling the developer
  installs is fine. FR-002 applies to end users, not to the development machine.
