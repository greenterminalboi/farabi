# Feature Specification: Farabi Visualization Engine

**Feature Branch**: `014-visualization`

**Created**: 2026-10-07

**Status**: Draft

**Depends on**: the AI provider boundary (Feature 1 `contracts/ai-provider.md`, Feature 12's per-call
model and effort options, Feature 11's `providerReady()` guard). Nothing else: the engine is
deliberately standalone.

**Input**: User description: "I want a visualization tool integrated within farabi itself, animated
or image generated, I want to tie this in as another dimension for farabi, for example a piece of
drill code can be visualized, an algorithm can be visualized, a contradiction can be visualized …
only worry about the visualization engine for now and nothing else."

Coordinator brief (2026-10-07): the engine takes a typed, versioned, validated declarative scene
(elements, layout, styles and a timeline of steps) and renders it animated (play, pause, step,
scrub, respecting reduced motion) and as a still image of any frame. Three families with a small set
of composable building blocks: code, algorithms, contradictions/arguments. Scenes can be generated
from text by the configured AI provider, validated, retried once, and otherwise refused with nothing
written. A preview page shows a gallery of hand-written examples and a paste-to-generate box.
Engine only: no integration into the canvas, drill, lexicon, node kinds or functions.

## Clarifications

### Session 2026-10-07 (decided by lane, owner to confirm)

The owner is away; each answer is the most conservative reasonable option.

- Q: Is the preview page available in the packaged desktop app, or only in development? → A: It is
  available at a fixed address in every build but not linked from any menu. It writes nothing, and
  generating only runs when the user presses Generate, so it costs nothing unless used (FR-019).
- Q: Are generated scenes saved anywhere? → A: No. A generated scene lives only on the preview page
  until it is closed. The user can export it as an image or copy its description. Storage is a later
  integration step (FR-021).
- Q: How is AI-generated content marked? → A: Every scene records where it came from
  (hand-written or AI-suggested). Generation always marks its result AI-suggested, whatever the AI
  claimed, and the player shows a visible "AI-suggested" label on such scenes, also inside exported
  images (FR-016, Article I).
- Q: Does the generator explain or judge the source (for example, say which side of a contradiction
  is right)? → A: No. It only depicts the structure present in the given text: it never adds
  verdicts, insight about the user or claims not in the text (FR-017, Article III).
- Q: How long may a generated scene be? → A: Bounded: at most 200 elements and 100 steps, and the
  source text at most 20,000 characters. Larger requests are refused before any AI call (FR-013).
- Q: Which model and effort does generation use? → A: The configured default model unless the
  request names one of the app's known models; medium effort.
- Q: Still image formats? → A: Both a vector image (SVG) and a raster image (PNG, at 2× scale) of the
  current frame.
- Q: With reduced motion on, does Play still advance? → A: Yes, step by step with a pause on each
  step, but with no in-between movement; each step appears at once.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Watch a hand-written visualization (Priority: P1)

A developer (and later, any Farabi screen) gives the engine a scene description. The engine draws
it and plays its steps: the user presses Play and watches an array get sorted, a function run line
by line, or two claims pull against each other. They can pause, step forward and back, and drag a
scrubber to any point. Every step has a caption that is shown and announced.

**Why this priority**: drawing and animating a valid scene is the engine. Everything else (stills,
generation, preview gallery) builds on it.

**Independent Test**: open the preview page, pick a gallery example of each family, press Play,
Pause, Next and Previous and drag the scrubber; the drawing and caption change accordingly, and the
keyboard does the same.

**Acceptance Scenarios**:

1. **Given** a valid scene, **When** it is opened, **Then** its first frame is drawn with its title,
   the step counter reads "Step 0 of N" and the scene's text description is available to assistive
   technology.
2. **Given** a scene on step 0, **When** the user presses Play, **Then** the steps advance one after
   another with smooth movement between them (positions, appearance, values) and stop at the last
   step.
3. **Given** a playing scene, **When** the user presses Pause, **Then** it stops where it is; Next
   and Previous move exactly one step; dragging the scrubber shows the in-between state for any
   position.
4. **Given** reduced motion is preferred, **When** the user presses Play, **Then** each step appears
   at once with no in-between movement.
5. **Given** keyboard focus on the player, **When** the user presses Space, Left, Right, Home or End,
   **Then** it plays or pauses, steps back, steps forward, goes to the start or goes to the end.
6. **Given** any step, **Then** its caption is shown and announced politely, and a full text
   alternative (scene description plus every step's caption) is available on request.

---

### User Story 2 - Export a frame as an image (Priority: P1)

The owner asked for "animated or image generated". At any point the user can save the current frame
as an image, vector or raster, that looks like what's on screen in the current light or dark theme.
Other parts of Farabi can later ask the engine for a still of any frame without showing a player.

**Why this priority**: stills are half of the owner's request and the simplest way to put a
visualization anywhere (a node, a drill card, a document).

**Independent Test**: on the preview page, step to a frame, export SVG and PNG; both files open and
show that frame, with the scene's title and description embedded as text.

**Acceptance Scenarios**:

1. **Given** a scene on frame k, **When** the user exports SVG, **Then** a self-contained SVG of
   frame k downloads, with the theme's colours fixed in it and the scene title and step caption as
   its text alternative.
2. **Given** the same frame, **When** the user exports PNG, **Then** a PNG of the same picture at 2×
   downloads.
3. **Given** a scene description and a frame number, **When** another part of the app asks for a
   still without a player (including on the server), **Then** it gets the same SVG.

---

### User Story 3 - Generate a visualization from text (Priority: P2)

The user pastes source text (a code snippet, an algorithm description, or two conflicting
statements) and presses Generate. The configured AI provider proposes a scene, the engine checks it,
and the scene plays in the player marked AI-suggested. If the AI's answer can't be used even after
one corrected retry, the user sees a clear error and nothing appears.

**Why this priority**: it makes the engine useful without hand-writing scenes, but the engine
stands on its own without it.

**Independent Test**: with the fake provider, paste a snippet of each family and press Generate; a
valid AI-suggested scene plays. Make the fake reply invalid twice; a clear error appears and no
scene is shown.

**Acceptance Scenarios**:

1. **Given** source text and a ready provider, **When** the user presses Generate, **Then** a valid
   scene marked AI-suggested is shown in the player.
2. **Given** the AI's first reply is invalid and its second is valid, **Then** the second is used.
3. **Given** both replies are invalid, or the provider fails, **Then** the user sees "The AI
   couldn't produce a usable visualization. Nothing was created. Try again." and no scene appears.
4. **Given** the provider isn't ready (no API key, Claude Code missing or signed out), **Then** no AI
   call is made and the error links to Settings.
5. **Given** empty text, or text over the limit, **Then** it is refused before any AI call.

---

### User Story 4 - Browse the gallery and check a scene by hand (Priority: P3)

A developer integrating the engine later opens the preview page, browses the hand-written examples
of each family and pastes a scene description of their own to see it rendered or see exactly why it
is invalid.

**Why this priority**: it is the documentation and test bench for later integration.

**Independent Test**: paste a valid scene description; it plays. Paste an invalid one; the problems
are listed with their location in the description, and nothing is drawn.

**Acceptance Scenarios**:

1. **Given** the preview page, **Then** the gallery lists at least two examples for each of code,
   algorithm and argument, each playable.
2. **Given** a pasted scene description with errors (a missing field, a step pointing at an element
   that doesn't exist), **When** the user presses Render, **Then** each problem is listed with its
   path and nothing is drawn.

### Edge Cases

- A scene with no steps: shows its single frame; Play, Next and the scrubber are disabled.
- A scene description of an unknown future version: refused with "unsupported scene version".
- A step that refers to an element, array cell, code line or graph node that doesn't exist:
  refused at validation, never a broken drawing.
- Very long labels or code lines: shortened with an ellipsis on screen; the full text stays in the
  text alternative.
- Theme switches while open: the drawing follows the new theme without reloading.
- The AI wraps its JSON in prose or code fences: the JSON object is extracted before validation.
- The AI returns a scene claiming to be hand-written: it is still marked AI-suggested.
- The user presses Generate twice: the first request is cancelled; only the last result shows.
- Exporting during playback: exports the exact in-between frame on screen.

## Requirements *(mandatory)*

### Functional Requirements

**Scene description**

- **FR-001**: A scene MUST be a declarative data description with a version number (1 in this
  release), a title, a text description, a family (code, algorithm, argument or general), an origin
  (user-authored or ai-suggested), a set of elements and an ordered list of steps.
- **FR-002**: The engine MUST validate every scene before drawing it and MUST refuse invalid ones
  with a list of problems, each with its location in the description. Validation MUST include
  references: every step target (element, part of an element) MUST exist.
- **FR-003**: The building blocks MUST stay small and composable: a box (with shape and role), a
  text label, a connector between two elements (with a relation: plain, supports, attacks,
  conflicts), a code block, an array, a variable panel, a stack, and a graph (nodes and edges laid out
  as a tree, layers, a circle or a row).
- **FR-004**: Steps MUST be made of a small set of actions: highlight or clear a part, set a value,
  swap two array cells, mark a comparison, move a named pointer, push or pop a stack frame, show or
  hide an element or part, move an element, and set the current code line (with optional token
  ranges). Each step MUST have a caption.
- **FR-005**: Meaning MUST never rest on colour alone: relations differ by line style and arrowhead
  (supports: solid arrow; attacks: dashed line with a bar; conflicts: zigzag with two heads and a
  label), and highlights also change outline weight.

**Player**

- **FR-006**: The player MUST draw any frame of a valid scene and play, pause, step forward and
  back, go to start or end, and scrub to any position, including in-between positions.
- **FR-007**: Between steps, positions, sizes, opacity and values MUST change smoothly; with reduced
  motion preferred, steps MUST change instantly.
- **FR-008**: The player MUST be fully usable by keyboard (Space, Left, Right, Home, End, and the
  focusable buttons and scrubber) and MUST show and politely announce each step's caption.
- **FR-009**: Each scene MUST expose a text alternative: its title, description and, per frame, the
  caption plus a generated plain-text summary of the visible state (for example, array contents and
  highlighted cells, the current code line, stack frames).
- **FR-010**: Drawing MUST follow the app's light and dark colour tokens, and fall back to built-in
  values when a token is missing.

**Still images**

- **FR-011**: Any frame (whole or in-between) MUST be exportable as a self-contained SVG and as a
  PNG at 2× scale, with the theme colours fixed in the file and the scene title and caption embedded
  as text alternatives. Stills of AI-suggested scenes MUST carry the "AI-suggested" label.
- **FR-012**: Producing an SVG still MUST be possible without a browser (for later use from the
  server) and give the same picture as the player.

**Generation**

- **FR-013**: The server MUST offer scene generation from source text (1 to 20,000 characters) with
  an optional family hint (code, algorithm, argument, or automatic) and optional model choice.
- **FR-014**: Generation MUST check the provider is ready before any AI call, and answer "not ready"
  with a link to Settings otherwise.
- **FR-015**: Generation MUST validate the AI's answer against the scene rules (including element
  and step limits), retry once with the problem stated, and otherwise fail with a clear error.
  Nothing is stored in any case.
- **FR-016**: A generated scene MUST be marked ai-suggested regardless of the AI's answer, and the
  player and stills MUST show that label.
- **FR-017**: The generation instructions MUST confine the AI to depicting what is in the given
  text: no verdicts on which side is right, no claims about the user, no material not in the text.
- **FR-018**: Tests MUST exercise generation through the fake provider only; the fake MUST produce a
  valid deterministic scene for each family from the input text.

**Preview page**

- **FR-019**: A preview page MUST show a gallery of hand-written examples (at least two per family),
  the player, still export, a box to paste and render a scene description with its validation
  problems, and a box to paste source text and generate a scene with the configured provider.

**Boundaries**

- **FR-020**: The engine MUST NOT run generated code or evaluate strings as code in the browser
  (the desktop app's security policy forbids it).
- **FR-021**: The engine MUST NOT store anything and MUST NOT change any existing screen, node kind,
  function, drill or lexicon behaviour in this release.
- **FR-022**: The engine MUST expose a documented programming interface for later integration:
  validate a scene, compute any frame, draw a player, produce a still, and generate from text.

### Key Entities

- **Scene**: versioned description of one visualization: title, description, family, origin,
  canvas size, elements, steps.
- **Element**: one building block with a stable id: box, text, connector, code, array, panel,
  stack or graph. Some have addressable parts (array cells, code lines, panel rows, graph nodes and
  edges, stack frames).
- **Step**: a caption plus actions applied in order; optional duration.
- **Frame**: the state of all elements after a number of steps (0 to N); an in-between position
  blends two neighbouring frames.
- **Generation request**: source text, family hint, optional model; produces a Scene or a clean
  failure.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every gallery example of every family plays from start to end, steps both ways and
  exports SVG and PNG, in both the Chromium and WebKit engines.
- **SC-002**: A 200-element scene animates with a 95th-percentile frame time at or under 20 ms on
  the development machine.
- **SC-003**: 100% of invalid scenes in the test set are refused with at least one located problem;
  0 invalid scenes ever reach drawing.
- **SC-004**: Generation that fails validation twice, or whose provider fails, leaves nothing behind
  and shows the error within one second of the provider's last answer.
- **SC-005**: Every player control is reachable and usable with the keyboard alone, and every frame
  has a non-empty caption and text summary.
- **SC-006**: Producing an SVG still of any frame without a browser gives byte-identical output to
  the browser's export for the same theme colours.
- **SC-007**: The engine runs with no string-to-code evaluation: the preview page works under the
  desktop security policy without 'unsafe-eval'.

## Assumptions

- Single user, local app; the preview page needs no access control beyond the app's existing local
  request checks.
- Hand-written scenes are user-authored by definition; examples ship in the repository.
- Text measurement uses fixed character-width estimates (monospace for code), so layout is identical
  in the browser and without one; exact glyph widths are not needed.
- The colour tokens from the polish branch may or may not be present; the engine reads the CSS
  custom properties by name with fallbacks, so it works either way.
- Integration into the canvas, drill, lexicon, node kinds and functions is a later feature; this
  release only promises the interface it would use.
