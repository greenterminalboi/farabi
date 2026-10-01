import type { ComponentType } from "react";
import { ChatView } from "@/components/chat/ChatView";
import type { ViewId } from "@/shared/kinds";
import { OutputView } from "./OutputView";
import { PipeView } from "./PipeView";

/**
 * What opening a node shows, per view id (Feature 9, research R9). A kind declares its view id;
 * a new kind reuses one of these by declaration alone.
 */
export const VIEWS: Record<ViewId, ComponentType<{ nodeId: string }>> = {
  chat: ChatView,
  output_beside_input: OutputView,
  pipe: PipeView,
};
