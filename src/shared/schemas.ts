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
});
export type MapNode = z.infer<typeof MapNode>;

export const MapTree = z.object({
  id: z.string(),
  rootNodeId: z.string(),
  origin: z.object({ x: z.number(), y: z.number() }),
});
export type MapTree = z.infer<typeof MapTree>;

export const Message = z.object({
  id: z.string(),
  seq: z.number().int(),
  role: z.enum(["user", "ai"]),
  content: z.string(),
  status: z.enum(["pending", "complete", "failed"]),
  provenance: Provenance,
  createdAt: z.string(),
});
export type Message = z.infer<typeof Message>;

export const Marker = z.object({
  id: z.string(),
  messageId: z.string(),
  start: z.number().int(),
  end: z.number().int(),
  anchorText: z.string(),
  childNodeId: z.string(),
});
export type Marker = z.infer<typeof Marker>;

// Endpoint payloads

export const ForestResponse = z.object({ trees: z.array(MapTree), nodes: z.array(MapNode) });
export type ForestResponse = z.infer<typeof ForestResponse>;

export const CreateTreeResponse = z.object({ tree: MapTree, node: MapNode });
export type CreateTreeResponse = z.infer<typeof CreateTreeResponse>;

export const OriginRequest = z.object({ x: z.number().finite(), y: z.number().finite() });
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
export const SendMessageResponse = z.object({ userMessage: Message, aiMessage: Message });
export type SendMessageResponse = z.infer<typeof SendMessageResponse>;

export const RetryResponse = z.object({ aiMessage: Message });
export const RegenerateResponse = z.object({
  aiMessage: Message,
  replaced: z.object({ id: z.string(), replacedAt: z.string() }),
});

export const RefreshResponse = z.object({ queued: z.literal(true) });
export const RefreshStaleResponse = z.object({ queued: z.number().int() });

export const ErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
