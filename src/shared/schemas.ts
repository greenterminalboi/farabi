import { z } from "zod";

// Shapes from specs/001-branching-chat-map/contracts/http-api.md

export const Provenance = z.enum(["ai_suggested", "user_confirmed", "user_authored"]);
export type Provenance = z.infer<typeof Provenance>;

export const Summary = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("placeholder"), text: z.string() }),
  z.object({
    kind: z.literal("summary"),
    text: z.string(),
    provenance: Provenance,
    throughMessageId: z.string(),
    createdAt: z.string(),
  }),
]);
export type Summary = z.infer<typeof Summary>;

export const Anchor = z.object({
  messageId: z.string().uuid(),
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  text: z.string(),
  prefix: z.string().max(32),
  suffix: z.string().max(32),
});
export type Anchor = z.infer<typeof Anchor>;

export const MapNode = z.object({
  id: z.string(),
  treeId: z.string(),
  parentId: z.string().nullable(),
  isRoot: z.boolean(),
  anchorText: z.string().nullable(),
  summary: Summary,
  createdAt: z.string(),
  /** Hand-placed position relative to the tree origin (Feature 2). */
  manual: z.object({ x: z.number(), y: z.number() }).nullable(),
  /** Label on the edge from this node to its parent (Feature 2). */
  edgeLabel: z.string().nullable(),
  /** Live messages in the conversation; the map draws deep ones as a stack. */
  messageCount: z.number().int(),
});
export type MapNode = z.infer<typeof MapNode>;

export const MapTree = z.object({
  id: z.string(),
  rootNodeId: z.string(),
  origin: z.object({ x: z.number(), y: z.number() }),
  userPlaced: z.boolean(),
});
export type MapTree = z.infer<typeof MapTree>;

export const Message = z.object({
  id: z.string(),
  seq: z.number().int(),
  role: z.enum(["user", "ai"]),
  content: z.string(),
  status: z.enum(["pending", "complete", "failed", "incomplete", "stopped"]),
  provenance: Provenance,
  createdAt: z.string(),
  /** Text so far while a reply is streaming (Feature 2). */
  partialContent: z.string().nullable(),
});
export type Message = z.infer<typeof Message>;

export const Marker = z.object({
  id: z.string(),
  messageId: z.string(),
  start: z.number().int(),
  end: z.number().int(),
  anchorText: z.string(),
  childNodeId: z.string(),
  kind: z.enum(["selection", "whole_message"]),
});
export type Marker = z.infer<typeof Marker>;

// Endpoint payloads

export const ForestResponse = z.object({ trees: z.array(MapTree), nodes: z.array(MapNode) });
export type ForestResponse = z.infer<typeof ForestResponse>;

export const CreateTreeResponse = z.object({ tree: MapTree, node: MapNode });
export type CreateTreeResponse = z.infer<typeof CreateTreeResponse>;

export const OriginRequest = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  byUser: z.boolean().optional(),
});
export const PositionRequest = z.object({ x: z.number().finite(), y: z.number().finite() });
export const NodeResponse = z.object({ node: MapNode });
export const EdgeLabelRequest = z.object({ text: z.string().nullable() });
export const OriginResponse = z.object({ tree: MapTree });

export const InheritedContextEntry = z.object({ nodeId: z.string(), messages: z.array(Message) });
export type InheritedContextEntry = z.infer<typeof InheritedContextEntry>;

export const NodeView = z.object({
  node: MapNode,
  anchor: Anchor.nullable(),
  inheritedContext: z.array(InheritedContextEntry),
  messages: z.array(Message),
  markers: z.array(Marker),
  canRegenerate: z.object({ messageId: z.string() }).nullable(),
});
export type NodeView = z.infer<typeof NodeView>;

export const BranchResponse = z.object({ node: MapNode, marker: Marker });
export type BranchResponse = z.infer<typeof BranchResponse>;

export const SendMessageRequest = z.object({ content: z.string() });
export const SendMessageResponse = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), userMessage: Message, aiMessage: Message }),
  z.object({
    kind: z.literal("quick_branch"),
    node: MapNode,
    marker: Marker,
    userMessage: Message,
    aiMessage: Message,
  }),
]);
export type SendMessageResponse = z.infer<typeof SendMessageResponse>;
export const StopResponse = z.object({ message: Message });

export const RetryResponse = z.object({ aiMessage: Message });
export const RegenerateResponse = z.object({
  aiMessage: Message,
  replaced: z.object({ id: z.string(), replacedAt: z.string() }),
});

export const RefreshResponse = z.object({ queued: z.literal(true) });

/** A suggested place to branch in a completed AI reply (Feature 5). Never stored as structure. */
export const SuggestedSpan = z.object({ start: z.number().int(), end: z.number().int(), text: z.string() });
export type SuggestedSpan = z.infer<typeof SuggestedSpan>;

export const SuggestionsResponse = z.object({
  /** Analyzed live, complete AI messages; [] means nothing to suggest. */
  byMessage: z.record(z.string(), z.array(SuggestedSpan)),
  /** Messages still being analyzed. */
  pending: z.array(z.string()),
});
export type SuggestionsResponse = z.infer<typeof SuggestionsResponse>;
export const RefreshStaleResponse = z.object({ queued: z.number().int() });

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
  source: z.object({ nodeId: z.string(), messageId: z.string() }),
  status: z.enum(["drafting", "failed", "draft", "confirmed"]),
  current: DefinitionVersion.nullable(),
  createdAt: z.string(),
});
export type Definition = z.infer<typeof Definition>;

export const CaptureRequest = z.object({
  nodeId: z.string().uuid(),
  messageId: z.string().uuid(),
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
export const FeedbackView = z.enum(["chat", "map", "definitions"]);
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
  context: z.object({ view: FeedbackView, nodeId: z.string().nullable() }),
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
    nodeId: z.string().uuid().nullable().default(null),
    tags: z
      .array(z.string().trim().min(1).max(FEEDBACK_TAG_MAX))
      .default([]),
  })
  .refine((f) => f.nodeId === null || f.view === "chat", "A node can only be recorded from the chat view");
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
