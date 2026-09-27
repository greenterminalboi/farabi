# Farabi Constitution

This document governs every spec, plan, and task written for this project. Anything proposed
later (a feature, a data model change, an AI behavior) MUST be checked against these articles
before it is accepted. Where a future spec conflicts with this constitution, the constitution
wins; the spec MUST be revised, not the other way around.

## Core Principles

### I. The User Is the Final Authority

The AI assists. It never decides on the user's behalf.

Every object the AI touches or produces (a placement, a connection, a summary, a derivation, a
notation symbol, a suggestion of any kind) MUST carry an explicit state distinguishing:

- **ai-suggested**: proposed, not yet reviewed by the user
- **user-confirmed**: proposed by the AI, explicitly accepted by the user
- **user-authored**: created directly by the user, no AI involved

No feature may treat ai-suggested content as equivalent to user-confirmed or user-authored
content anywhere in the system: not in the map's visual rendering, not in what counts toward
saturation or depth, not in what a later derivation is permitted to build on. If a feature
cannot cleanly express this distinction, the feature is not ready to be specced.

### II. Growth Is Additive, Never Reconciled

The structure is a forest of trees that only grows. There is no merge, no rebase, no
reconciliation of divergent branches back into a single version of the truth.

- A branch is not a competing version of its parent. It is a new, independent node that
  happens to have been caused by a fragment of the parent.
- No feature may introduce merge semantics, conflict resolution, or any mechanic that treats
  two nodes as versions of "the same thing" needing to be reconciled.
- Deletion of a node SHOULD be rare and MUST be explicit (a user choice). It MUST never be an
  automatic side effect of another operation (e.g. a branch is never deleted because its parent
  changed).

### III. Nothing Is Invented Ahead of Evidence

The AI may only propose structure that is justified by material that already exists in the
user's own system. It MUST NOT originate content from general knowledge dressed up as personal
insight.

- **Connections** MUST be proposed only because a real relationship is evident between the
  user's own nodes, not because two topics are generically related in the world at large.
- **Coupling** (a load-bearing, often directional dependency between nodes) MUST be proposed
  only where the dependency is evident from the user's own material, not assumed from a generic
  curriculum ordering.
- **Notation** MAY be proposed only once a recurring logical shape has actually appeared across
  multiple user-confirmed derivations. A symbol invented to make the map look tidier, with no
  repeated pattern behind it, violates this article.
- **Ghost peaks / Socratic prompts** MUST be derived from the user's actual topology (an
  implied-but-missing coupling, a thin node adjacent to a saturated one), never generated from
  a generic question bank or a topic list unrelated to what the user has actually built.
- **Derivations** (formalization) MUST be explicitly and visibly marked as unverified until the
  user validates them, and MUST never be presented with the same visual or structural
  confidence as user-confirmed material.

### IV. User-Led Exploration Takes Priority

The AI's suggestions (ghost peaks, Socratic questions, proposed placements) are a fallback, not
the primary driver of growth. A user bringing in a topic unprompted is always the preferred
path.

- Any feature that surfaces AI-initiated suggestions MUST be able to stay quiet by default and
  MUST never block, precede, or crowd out a user starting their own new thread or branch.
- Suggestion density SHOULD default toward sparse. A feature that surfaces many simultaneous
  AI-initiated prompts MUST carry explicit justification against this article before it ships.

### V. Compression Preserves Meaning, Not Just Length

Reducing content (a node summary, a bare-bones distillation, a zoomed-out label) MUST never
discard the part of the content that made it non-obvious or load-bearing. Compression that
produces a shorter but misleading or hollowed-out statement is a defect, not an acceptable
tradeoff for brevity.

- Summaries MUST reflect where a conversation actually ended up, not just its original framing.
- Any zoomed-out or symbolic representation of a node MUST remain traceable back to the
  full-fidelity version it was derived from.

### VI. History Is Data, Not Decoration

The order and manner in which the user built their own structure (what was painted first, what
was abandoned, what was returned to) is a first-class signal about how that individual learns,
not merely a nice-to-look-at replay feature.

- Any personalization of AI behavior (e.g. how aggressively to suggest, how wide or deep to
  place ghost peaks) MUST be derived from observed behavior, never from user self-report or a
  static preference form standing in for it.

## Governance

This constitution supersedes every spec, plan, and task. Where they conflict, the spec, plan,
or task is revised.

**Amendments**: This constitution changes rarely and deliberately. A proposed amendment MUST
state which article it modifies and why the existing article is insufficient. It is not amended
to accommodate a single feature's convenience.

**Versioning**: The version follows semantic versioning:

- MAJOR: an article is removed or redefined in a backward-incompatible way.
- MINOR: an article or section is added, or guidance is materially expanded.
- PATCH: clarifications, wording, and typo fixes with no change in meaning.

**Compliance review**: Every spec, plan, and task list MUST be checked against these articles
before it is accepted (the plan's Constitution Check gate). A violation MUST either be removed
or be resolved through a formal amendment; it is never waived for a single feature.

**Version**: 1.0.0 | **Ratified**: 2026-09-26 | **Last Amended**: 2026-09-26
