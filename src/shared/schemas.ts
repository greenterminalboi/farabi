import { z } from "zod";

// Shapes from the features' contracts/http-api.md. The graph and canvas shapes are Feature 10's
// (specs/010-v02-message-graph-canvas/contracts/http-api.md).

export const Provenance = z.enum(["ai_suggested", "user_confirmed", "user_authored"]);
export type Provenance = z.infer<typeof Provenance>;

export const Shape = z.enum(["node", "edge"]);
export type Shape = z.infer<typeof Shape>;
export const ElementOrigin = z.enum([
  "origin",
  "ask",
  "branch",
  "quick_branch",
  "parked",
  "reply",
  "retry",
  "regenerate",
  "run",
  // Feature 12: a drill started from an existing element.
  "drill",
]);
export type ElementOrigin = z.infer<typeof ElementOrigin>;
export const EdgeState = z.enum(["unsent", "replying", "answered", "incomplete", "stopped", "failed"]);
export type EdgeState = z.infer<typeof EdgeState>;
export const AnswerStatus = z.enum(["pending", "complete", "incomplete", "stopped", "failed"]);
export type AnswerStatus = z.infer<typeof AnswerStatus>;
export const Review = z.enum(["proposed", "confirmed", "rejected"]);
export type Review = z.infer<typeof Review>;

/** A span of an element's text: raw offsets, the exact text and 32 characters on each side. */
export const Span = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  text: z.string(),
  prefix: z.string().max(32),
  suffix: z.string().max(32),
});
export type Span = z.infer<typeof Span>;

/** A span as a client sends it; the server computes prefix and suffix. */
export const SpanRequest = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  text: z.string(),
});
export type SpanRequest = z.infer<typeof SpanRequest>;

/** Every graph element: a node (answer, function output) or an edge (question, function). */
export const Element = z.object({
  id: z.string(),
  treeId: z.string(),
  parentId: z.string().nullable(),
  kind: z.string(),
  shape: Shape,
  origin: ElementOrigin,
  /** Creation provenance. Review state is always shown through `review` (Article I). */
  provenance: Provenance,
  /** Null for an unsent question edge and for a function edge. */
  text: z.string().nullable(),
  createdAt: z.string(),
  /** Hand placement relative to the tree origin (FR-037). */
  manual: z.object({ x: z.number(), y: z.number() }).nullable(),
  // question edges
  state: EdgeState.optional(),
  /** Where a branch or parked edge leaves its parent's text. */
  anchor: Span.nullable().optional(),
  requeryOf: z.string().nullable().optional(),
  /** Current edge note (FR-040). */
  note: z.string().nullable().optional(),
  sentAt: z.string().nullable().optional(),
  // answers
  status: AnswerStatus.optional(),
  partialText: z.string().nullable().optional(),
  pressureLevel: z.number().int().nullable().optional(),
  replyModel: z.string().nullable().optional(),
  // function edges and outputs
  functionId: z.string().optional(),
  functionName: z.string().optional(),
  functionVersion: z.number().int().optional(),
  /** Outputs: newest review. Function edges: derived from their outputs. */
  review: Review.optional(),
  /**
   * Canvas only: the nearest drawn ancestor, when the parent is a kind kept off the canvas
   * (`onCanvas: false`, Feature 12). The canvas draws the element from it.
   */
  drawnFrom: z.string().optional(),
  /** Canvas only: what a card display (Feature 12's drill) shows, and where Open goes. */
  card: z.object({ title: z.string(), lines: z.array(z.string()), href: z.string() }).optional(),
  /** Feature 13: lexicon terms on a question edge (asked for) or an answer (sent), as id and version. */
  lexicon: z.array(z.object({ id: z.string(), v: z.number().int() })).optional(),
});
export type Element = z.infer<typeof Element>;

export const Tree = z.object({
  id: z.string(),
  origin: z.object({ x: z.number(), y: z.number() }),
  userPlaced: z.boolean(),
  /** The origin edge's earliest answer (FR-005). */
  rootAnswerId: z.string().nullable(),
});
export type Tree = z.infer<typeof Tree>;

export const Camera = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  scale: z.number().min(0.02).max(4),
});
export type Camera = z.infer<typeof Camera>;

export const CanvasResponse = z.object({
  trees: z.array(Tree),
  elements: z.array(Element),
  camera: Camera.nullable(),
});
export type CanvasResponse = z.infer<typeof CanvasResponse>;

export const CameraResponse = z.object({ camera: Camera });
export const OriginRequest = z.object({ x: z.number().finite(), y: z.number().finite() });
export const OriginResponse = z.object({ tree: Tree });
export const PositionRequest = z.object({ x: z.number().finite(), y: z.number().finite() });
export const ElementResponse = z.object({ element: Element });

// Asking

/** Feature 13: lexicon term ids attached as chips; the server checks them (FR-008). */
const Terms = z.array(z.string()).max(6).optional();

export const StartTreeRequest = z.object({ projectId: z.string().uuid(), content: z.string(), terms: Terms });
export const StartTreeResponse = z.object({ tree: Tree, edge: Element, answer: Element });
export type StartTreeResponse = z.infer<typeof StartTreeResponse>;

export const AskRequest = z.object({ content: z.string(), terms: Terms });
export const AskResponse = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), edge: Element, answer: Element }),
  z.object({ kind: z.literal("quick_branch"), edge: Element, answer: Element }),
]);
export type AskResponse = z.infer<typeof AskResponse>;

export const BranchRequest = SpanRequest;
export const BranchResponse = z.object({ edge: Element });
export type BranchResponse = z.infer<typeof BranchResponse>;

export const SendRequest = z.object({ content: z.string(), terms: Terms });
export const SendResponse = z.object({ edge: Element, answer: Element });
export type SendResponse = z.infer<typeof SendResponse>;

export const AttemptRequest = z.object({ mode: z.enum(["retry", "regenerate"]) });
export const AnswerResponse = z.object({ answer: Element });
export type AnswerResponse = z.infer<typeof AnswerResponse>;

// Notes, the side panel and parked tangents

export const NoteRequest = z.object({ text: z.string().nullable() });
export const EdgeResponse = z.object({ edge: Element });

/** A tangent parked from an element's text, not yet a branch (Feature 8). */
export const ParkedTangent = z.object({
  id: z.string(),
  nodeId: z.string(),
  anchor: Span,
  /** The typed question exactly as typed; null when there is none. */
  question: z.string().nullable(),
  createdAt: z.string(),
});
export type ParkedTangent = z.infer<typeof ParkedTangent>;

export const PanelResponse = z.object({ children: z.array(Element), parked: z.array(ParkedTangent) });
export type PanelResponse = z.infer<typeof PanelResponse>;

export const ParkRequest = SpanRequest.extend({ question: z.string().nullable().optional() });
export type ParkRequest = z.infer<typeof ParkRequest>;
export const ParkedQuestionRequest = z.object({ question: z.string().nullable() });
export const ParkedResponse = z.object({ parked: ParkedTangent });
export const FireParkedResponse = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sent"), edge: Element, answer: Element }),
  z.object({ kind: z.literal("preload"), edge: Element, draft: z.string() }),
]);
export type FireParkedResponse = z.infer<typeof FireParkedResponse>;

export const ErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

// Feature 2: definitions

export const DefinitionVersion = z.object({
  generalText: z.string(),
  usageText: z.string(),
  provenance: z.enum(["ai_suggested", "user_confirmed"]),
  createdAt: z.string(),
});
export type DefinitionVersion = z.infer<typeof DefinitionVersion>;

export const Definition = z.object({
  id: z.string(),
  term: z.string(),
  termKey: z.string(),
  /** Where the term was captured (FR-055). The element is null on an old row that couldn't be resolved. */
  source: z.object({
    elementId: z.string().nullable(),
    kind: z.string().nullable(),
    excerpt: z.string(),
    projectId: z.string(),
  }),
  status: z.enum(["drafting", "failed", "draft", "confirmed"]),
  current: DefinitionVersion.nullable(),
  createdAt: z.string(),
});
export type Definition = z.infer<typeof Definition>;

export const CaptureRequest = z.object({
  nodeId: z.string().uuid(),
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  text: z.string(),
});
export const CaptureResponse = z.object({ definition: Definition, created: z.boolean() });
export const DefinitionsResponse = z.object({ definitions: z.array(Definition) });
export const TermIndexEntry = z.object({ id: z.string(), term: z.string(), termKey: z.string() });
export type TermIndexEntry = z.infer<typeof TermIndexEntry>;
export const TermIndexResponse = z.object({ terms: z.array(TermIndexEntry) });
export const DefinitionDetailResponse = z.object({
  definition: Definition,
  versions: z.array(DefinitionVersion),
});
export const DefinitionResponse = z.object({ definition: Definition });
export const EditDefinitionRequest = z.object({ generalText: z.string(), usageText: z.string() });

// Feature 3: feedback (specs/003-feedback-loop/contracts/http-api.md)

export const FeedbackState = z.enum(["open", "addressed", "resolved"]);
export type FeedbackState = z.infer<typeof FeedbackState>;
export const FeedbackView = z.enum(["chat", "map", "definitions", "canvas"]);
export type FeedbackView = z.infer<typeof FeedbackView>;

export const FeedbackStateEvent = z.object({ state: FeedbackState, provenance: Provenance, at: z.string() });
export type FeedbackStateEvent = z.infer<typeof FeedbackStateEvent>;

export const FeedbackAttachment = z.object({
  id: z.string(),
  url: z.string(),
  thumbUrl: z.string(),
  /** Relative to the repo root, as written in FEEDBACK.md. */
  path: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int(),
  createdAt: z.string(),
});
export type FeedbackAttachment = z.infer<typeof FeedbackAttachment>;

export const FeedbackItem = z.object({
  id: z.string(),
  text: z.string(),
  context: z.object({
    view: FeedbackView,
    /** v1 conversation, on items captured before v0.2. */
    nodeId: z.string().nullable(),
    projectId: z.string().nullable(),
    elementId: z.string().nullable(),
    /** The element's kind and the start of its text (FR-058). */
    element: z.object({ kind: z.string(), excerpt: z.string() }).nullable(),
  }),
  tags: z.array(z.object({ text: z.string(), key: z.string() })),
  attachments: z.array(FeedbackAttachment),
  state: FeedbackState,
  /** Oldest first, never shortened. */
  history: z.array(FeedbackStateEvent),
  manuallyPlaced: z.boolean(),
  createdAt: z.string(),
});
export type FeedbackItem = z.infer<typeof FeedbackItem>;

export const FeedbackListResponse = z.object({ items: z.array(FeedbackItem) });
export const FeedbackItemResponse = z.object({ item: FeedbackItem });
export const FeedbackPositionRequest = z.object({
  aboveId: z.string().uuid().nullable(),
  belowId: z.string().uuid().nullable(),
});

export const FEEDBACK_TEXT_MAX = 20000;
export const FEEDBACK_TAG_MAX = 60;
export const FEEDBACK_MAX_IMAGES = 10;
export const FEEDBACK_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const FeedbackCreateFields = z
  .object({
    text: z
      .string()
      .max(FEEDBACK_TEXT_MAX)
      .refine((t) => t.trim().length > 0, "Feedback text is required"),
    view: FeedbackView,
    projectId: z.string().uuid().nullable().default(null),
    elementId: z.string().uuid().nullable().default(null),
    tags: z
      .array(z.string().trim().min(1).max(FEEDBACK_TAG_MAX))
      .default([]),
  })
  .refine((f) => f.elementId === null || f.view === "canvas", "An element can only be recorded from the canvas");
export type FeedbackCreateFields = z.input<typeof FeedbackCreateFields>;

// Feature 4: projects (specs/004-projects/plan.md)

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  trashedAt: z.string().nullable(),
});
export type Project = z.infer<typeof Project>;

export const ProjectsResponse = z.object({
  projects: z.array(Project),
  trashed: z.array(Project),
  currentId: z.string(),
});
export const ProjectResponse = z.object({ project: Project });
export const TrashProjectResponse = z.object({ currentId: z.string() });
export const CreateProjectRequest = z.object({
  name: z
    .string()
    .transform((n) => n.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(1, "A project needs a name").max(80, "Project names are limited to 80 characters")),
});

/** Global reply settings (Feature 6, contracts/http-api.md). */
export const SettingsResponse = z.object({
  informationPressure: z.number().int().min(1).max(10),
  replyModel: z.string(),
  models: z.array(z.object({ id: z.string(), label: z.string() })),
});
export type SettingsResponse = z.infer<typeof SettingsResponse>;

export const SaveSettingsBody = z
  .object({
    informationPressure: z.number().int().min(1).max(10).optional(),
    replyModel: z.string().optional(),
  })
  .refine((b) => b.informationPressure !== undefined || b.replyModel !== undefined, {
    message: "Nothing to save",
  });
export type SaveSettingsBody = z.infer<typeof SaveSettingsBody>;

// Feature 9: functions, reviews and kind settings, re-expressed on edges (Feature 10)

export const ResolvedSetting = z.object({
  key: z.string(),
  value: z.string(),
  source: z.enum(["override", "kind", "default"]),
  /** The kind-level value, if one is set. */
  kindValue: z.string().nullable(),
  /** When the value in effect at its scope was set; null for the default. */
  changedAt: z.string().nullable(),
});
export type ResolvedSetting = z.infer<typeof ResolvedSetting>;

export const FunctionsResponse = z.object({
  functions: z.array(z.object({ id: z.string(), name: z.string(), version: z.number().int(), outputKind: z.string() })),
});
export type FunctionsResponse = z.infer<typeof FunctionsResponse>;

export const RunFunctionResponse = z.object({ edge: Element, output: Element });
export type RunFunctionResponse = z.infer<typeof RunFunctionResponse>;
export const OutputResponse = z.object({ output: Element });
export type OutputResponse = z.infer<typeof OutputResponse>;

export const KindSettingsResponse = z.object({
  kinds: z.array(z.object({ kind: z.string(), label: z.string(), settings: z.array(ResolvedSetting) })),
});
export type KindSettingsResponse = z.infer<typeof KindSettingsResponse>;
export const SaveKindSettingBody = z.object({
  kind: z.string(),
  key: z.string(),
  value: z.string().nullable(),
  /** An override on one element of that kind (Feature 12, C6); absent sets the kind-level value. */
  nodeId: z.string().optional(),
});
export const SaveEdgeSettingBody = z.object({ key: z.string(), value: z.string().nullable() });
export const SettingResponse = z.object({ setting: ResolvedSetting });

// Feature 12: Drill Kaizen (specs/012-drill-kaizen/contracts/http-api.md)

export const DrillVerdict = z.enum(["solved", "partly_solved", "not_solved"]);
export type DrillVerdict = z.infer<typeof DrillVerdict>;
export const DrillResult = z.enum(["solved", "partly_solved", "not_solved", "unattempted"]);
export type DrillResult = z.infer<typeof DrillResult>;
export const RungState = z.enum(["locked", "open", "solid"]);
export type RungState = z.infer<typeof RungState>;
export const LevelCause = z.enum(["start", "auto", "recompute", "manual"]);

export const Rung = z.object({
  id: z.string(),
  name: z.string(),
  provenance: Provenance,
  removed: z.boolean(),
  state: RungState,
  level: z.number().int(),
  /** Every recorded change, oldest first; roundNumber is null for start and manual changes. */
  history: z.array(
    z.object({ roundNumber: z.number().int().nullable(), level: z.number().int(), state: RungState, cause: LevelCause, changeId: z.string() }),
  ),
});
export type Rung = z.infer<typeof Rung>;

/** What the canvas card shows (FR-024). */
export const DrillSummary = z.object({
  drillId: z.string(),
  nodeId: z.string(),
  domain: z.string(),
  started: z.boolean(),
  complete: z.boolean(),
  /** The newest open rung; `number` is its place among the rungs that aren't removed. */
  newestOpen: z.object({ rungId: z.string(), number: z.number().int(), name: z.string(), level: z.number().int() }).nullable(),
  parentDrill: z.object({ drillId: z.string(), domain: z.string() }).nullable(),
});
export type DrillSummary = z.infer<typeof DrillSummary>;

export const DrillAttempt = z.object({
  attempt: Element,
  verdict: Element.extend({ verdict: DrillVerdict, hinted: z.boolean() }).nullable(),
  /** The user's newest override of this attempt's verdict; it counts (FR-017). */
  override: z.object({ verdict: DrillVerdict, at: z.string() }).nullable(),
});
export type DrillAttempt = z.infer<typeof DrillAttempt>;

export const DrillProblem = z.object({
  element: Element,
  roundId: z.string(),
  rungIds: z.array(z.string()),
  level: z.number().int(),
  position: z.number().int(),
  result: DrillResult,
  flagged: z.boolean(),
  skipped: z.boolean(),
  /** The flagged problem this one replaces (FR-014). */
  replaces: z.string().nullable(),
  /** Shown only once a hint event exists. */
  hint: Element.nullable(),
  /** Shown only once revealed. */
  solution: Element.nullable(),
  attempts: z.array(DrillAttempt),
  followUps: z.array(z.object({ edgeId: z.string(), text: z.string().nullable(), createdAt: z.string() })),
});
export type DrillProblem = z.infer<typeof DrillProblem>;

export const DrillNoteEntry = z.object({
  changeId: z.string(),
  rungId: z.string(),
  from: z.number().int(),
  to: z.number().int(),
  fromState: RungState,
  toState: RungState,
  evidence: z.array(z.string()),
  cause: LevelCause,
});

export const DrillRound = z.object({
  roundId: z.string(),
  number: z.number().int(),
  ended: z.object({ by: z.enum(["all_answered", "user"]), at: z.string() }).nullable(),
  /** Why the round is short, when it is. */
  shortNote: z.string().nullable(),
  /** Lessons on rungs that opened for this round (FR-006). */
  lessons: z.array(Element.extend({ rungId: z.string() })),
  problems: z.array(DrillProblem),
  note: z.array(DrillNoteEntry),
  currentProblemId: z.string().nullable(),
});
export type DrillRound = z.infer<typeof DrillRound>;

export const Drill = DrillSummary.extend({
  projectId: z.string(),
  domainProvenance: Provenance,
  startEdgeId: z.string(),
  sourceNodeId: z.string().nullable(),
  ladder: z.object({ versionId: z.string(), provenance: Provenance, rungs: z.array(Rung) }),
  settings: z.object({ round_size: z.string(), open_level: z.string(), solid_level: z.string() }),
  rounds: z.array(DrillRound),
  attachments: z.array(z.object({ nodeId: z.string(), excerpt: z.string(), attachedAt: z.string() })),
  offer: z
    .object({
      offerId: z.string(),
      candidates: z.array(z.object({ nodeId: z.string(), domain: z.string(), excerpt: z.string() })),
      dismissed: z.boolean(),
      picked: z.array(z.string()),
    })
    .nullable(),
});
export type Drill = z.infer<typeof Drill>;

export const DrillResponse = z.object({ drill: Drill });
export type DrillResponse = z.infer<typeof DrillResponse>;
export const DrillsResponse = z.object({ drills: z.array(DrillSummary) });
export type DrillsResponse = z.infer<typeof DrillsResponse>;
/** Returned by actions that generate a round afterwards; the round's failure doesn't undo them. */
export const DrillStepResponse = z.object({
  drill: Drill,
  nextRoundError: z.object({ code: z.string(), message: z.string() }).optional(),
  /** Attempts: every problem of the open round now has a result, so the client ends it. */
  roundEnded: z.boolean().optional(),
});
export type DrillStepResponse = z.infer<typeof DrillStepResponse>;

export const CreateDrillBody = z.object({
  projectId: z.string().uuid(),
  domain: z.string(),
  sourceNodeId: z.string().uuid().optional(),
  offerId: z.string().uuid().optional(),
});
export const SaveLadderBody = z.object({
  rungs: z.array(z.object({ id: z.string().uuid().optional(), name: z.string(), removed: z.boolean().optional() })),
});
export const AttemptBody = z.object({ text: z.string() });
export const ProblemEventBody = z.object({
  type: z.enum(["hint", "reveal", "skip", "flag"]),
  reason: z.string().max(500).optional(),
});
export const OverrideBody = z.object({ verdict: DrillVerdict });
export const SetLevelBody = z
  .object({ level: z.number().int().min(1).max(10).optional(), state: RungState.optional() })
  .refine((b) => b.level !== undefined || b.state !== undefined, { message: "Give a level or a state" });
export const AttachmentBody = z.object({ nodeId: z.string().uuid(), action: z.enum(["attach", "detach"]) });
