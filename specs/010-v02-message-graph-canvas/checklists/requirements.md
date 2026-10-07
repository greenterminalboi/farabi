# Specification Quality Checklist: Farabi v0.2 — Message Graph and Canvas

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-01
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

Validation pass 1 found these issues, all fixed in the spec:

- **Constitution Check used the wrong article titles.** The input named Articles I–VI as "AI only
  suggests", "Nothing is deleted", "AI material is presented as AI", "The user leads", "Everything
  traces to its source" and "History is data". The ratified constitution (v1.0.1) titles them
  differently, and Articles III and V cover different ground. The table now uses the real titles,
  and each row's content is mapped to the article it serves. Article V (compression) gained a note
  on summaries being off and on clipped text.
- **FR-008 vs Feature 008**: "nothing in this feature can be deleted" conflicted with Feature 008's
  discardable parked tangents. It is now scoped to nodes and edges, with an assumption explaining
  why.
- **Tree defined two ways**: FR-005 said the tree shares "one root" and Key Entities said "one
  origin". Both now say "one origin edge".
- **Focus gesture**: User Story 5 said "double-click a node to focus it", while FR-037 and Story 6
  say a click focuses. Story 5 now says click.
- **FR-004**: added the origin-edge exception, which FR-005 implied.
- **FR-022 / FR-055**: widened from "node" to "node or edge" to match FR-016 and FR-026, where edges
  can be focused and hold selectable text.
- **Clarification cross-references**: FR-044–FR-045 and FR-044–FR-054 corrected to FR-043–FR-045 and
  FR-043–FR-054. FR-043 holds the kind declaration.
- **Implementation details**: "GPU" was removed from FR-031. The PixiJS, graphology, WebGL and WebGPU
  stack is kept only in Assumptions, labeled as an owner constraint for planning.
- Added assumptions for showing rejected outputs again, and for the focus gesture.

Known inherited technical vocabulary: "mounted text", "drawn layer" and "camera transform"
(FR-029–FR-034, SC-006) are kept on purpose. They state the user-visible guarantee that text is real
and selectable, and no plainer wording keeps them testable.
