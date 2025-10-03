"use client";

import { useEffect, useState } from "react";
import { ThreadManager, ThreadTree, ThreadNode } from "@/lib/thread-manager";

// Create a default empty tree for SSR
const createEmptyTree = (): ThreadTree => {
  const mainThreadId = ThreadManager.generateThreadId();
  return {
    threads: new Map([[mainThreadId, {
      id: mainThreadId,
      parentId: null,
      title: "Main Conversation",
      timestamp: Date.now(),
      messages: [],
      depth: 0,
    }]]),
    activeThreadId: mainThreadId,
    mainThreadId,
  };
};

export function useThreadBranching() {
  const [threadTree, setThreadTree] = useState<ThreadTree>(createEmptyTree());
  const [selectedText, setSelectedText] = useState<string>("");
  const [showBranchButton, setShowBranchButton] = useState(false);
  const [selectionPosition, setSelectionPosition] = useState({ x: 0, y: 0 });
  const [isClient, setIsClient] = useState(false);

  // Load thread tree on mount (client-side only)
  useEffect(() => {
    setIsClient(true);
    if (typeof window !== "undefined") {
      const tree = ThreadManager.loadThreadTree();
      setThreadTree(tree);
    }
  }, []);

  // Get current active thread
  const activeThread = threadTree.threads.get(threadTree.activeThreadId);

  // Get thread path for breadcrumbs
  const threadPath = ThreadManager.getThreadPath(
    threadTree,
    threadTree.activeThreadId
  );

  // Get thread hierarchy for sidebar
  const threadHierarchy = ThreadManager.getThreadHierarchy(threadTree);

  // Create a new branch
  const createBranch = (branchPoint: string, initialQuestion?: string, currentMessages: any[] = []) => {
    if (!selectedText || !isClient) return;

    const updatedTree = ThreadManager.createBranch(
      threadTree,
      selectedText,
      branchPoint,
      threadTree.activeThreadId,
      currentMessages
    );

    setThreadTree(updatedTree);
    // Don't clear selected text immediately - keep it highlighted
    // setSelectedText("");
    setShowBranchButton(false);

    // If there's an initial question, we'll handle it in the component
    return updatedTree.activeThreadId;
  };

  // Switch to a different thread
  const switchThread = (threadId: string) => {
    if (!isClient) return;
    const updatedTree = ThreadManager.switchThread(threadTree, threadId);
    setThreadTree(updatedTree);
  };

  // Update messages for current thread
  const updateMessages = (messages: any[]) => {
    if (!isClient) return;
    const updatedTree = ThreadManager.updateThreadMessages(
      threadTree,
      threadTree.activeThreadId,
      messages
    );
    setThreadTree(updatedTree);
  };

  // Delete a thread
  const deleteThread = (threadId: string) => {
    if (!isClient) return;
    const updatedTree = ThreadManager.deleteThread(threadTree, threadId);
    setThreadTree(updatedTree);
  };

  // Handle text selection
  const handleTextSelection = (
    text: string,
    position: { x: number; y: number }
  ) => {
    if (text.trim().length > 0) {
      setSelectedText(text);
      setSelectionPosition(position);
      setShowBranchButton(true);
    } else {
      setSelectedText("");
      setShowBranchButton(false);
    }
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedText("");
    setShowBranchButton(false);
  };

  return {
    threadTree,
    activeThread,
    threadPath,
    threadHierarchy,
    selectedText,
    showBranchButton,
    selectionPosition,
    createBranch,
    switchThread,
    updateMessages,
    deleteThread,
    handleTextSelection,
    clearSelection,
  };
}
