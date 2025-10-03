export interface ThreadNode {
  id: string;
  parentId: string | null;
  title: string;
  selectedText?: string;
  branchPoint?: string; // message ID where branch occurred
  timestamp: number;
  messages: any[]; // conversation history for this thread
  depth: number;
}

export interface ThreadTree {
  threads: Map<string, ThreadNode>;
  activeThreadId: string;
  mainThreadId: string;
}

export class ThreadManager {
  private static STORAGE_KEY = "farabi_thread_tree";

  // Generate unique thread ID
  static generateThreadId(): string {
    return `thread_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Get color for thread based on depth
  static getThreadColor(depth: number): string {
    const colors = [
      "transparent", // Main thread (depth 0)
      "rgba(59, 130, 246, 0.1)", // blue-500 with opacity
      "rgba(34, 197, 94, 0.1)", // green-500 with opacity
      "rgba(168, 85, 247, 0.1)", // purple-500 with opacity
      "rgba(251, 146, 60, 0.1)", // orange-500 with opacity
      "rgba(236, 72, 153, 0.1)", // pink-500 with opacity
    ];
    return colors[depth % colors.length];
  }

  // Get border color for thread based on depth
  static getThreadBorderColor(depth: number): string {
    const colors = [
      "transparent",
      "rgba(59, 130, 246, 0.3)",
      "rgba(34, 197, 94, 0.3)",
      "rgba(168, 85, 247, 0.3)",
      "rgba(251, 146, 60, 0.3)",
      "rgba(236, 72, 153, 0.3)",
    ];
    return colors[depth % colors.length];
  }

  // Load thread tree from localStorage
  static loadThreadTree(): ThreadTree {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Convert plain object to Map
        const threads = new Map(
          Object.entries(parsed.threads) as [string, ThreadNode][]
        );
        return {
          threads,
          activeThreadId: parsed.activeThreadId,
          mainThreadId: parsed.mainThreadId,
        };
      }
    } catch (error) {
      console.error("Error loading thread tree:", error);
    }

    // Create default main thread
    const mainThreadId = this.generateThreadId();
    const mainThread: ThreadNode = {
      id: mainThreadId,
      parentId: null,
      title: "Main Conversation",
      timestamp: Date.now(),
      messages: [],
      depth: 0,
    };

    return {
      threads: new Map([[mainThreadId, mainThread]]),
      activeThreadId: mainThreadId,
      mainThreadId,
    };
  }

  // Save thread tree to localStorage
  static saveThreadTree(tree: ThreadTree): void {
    try {
      // Convert Map to plain object for JSON serialization
      const serializable = {
        threads: Object.fromEntries(tree.threads),
        activeThreadId: tree.activeThreadId,
        mainThreadId: tree.mainThreadId,
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(serializable));
    } catch (error) {
      console.error("Error saving thread tree:", error);
    }
  }

  // Create a new branch from selected text
  static createBranch(
    tree: ThreadTree,
    selectedText: string,
    branchPoint: string,
    parentThreadId: string,
    currentMessages: any[] = []
  ): ThreadTree {
    const parentThread = tree.threads.get(parentThreadId);
    if (!parentThread) {
      console.error("Parent thread not found");
      return tree;
    }

    const newThreadId = this.generateThreadId();
    const truncatedText = selectedText.substring(0, 50) + (selectedText.length > 50 ? "..." : "");
    
    // Copy all messages from parent thread to maintain conversation history
    const inheritedMessages = [...currentMessages];
    
    const newThread: ThreadNode = {
      id: newThreadId,
      parentId: parentThreadId,
      title: `Branch: "${truncatedText}"`,
      selectedText,
      branchPoint,
      timestamp: Date.now(),
      messages: inheritedMessages,
      depth: parentThread.depth + 1,
    };

    const updatedThreads = new Map(tree.threads);
    updatedThreads.set(newThreadId, newThread);

    const updatedTree = {
      ...tree,
      threads: updatedThreads,
      activeThreadId: newThreadId,
    };

    this.saveThreadTree(updatedTree);
    return updatedTree;
  }

  // Switch to a different thread
  static switchThread(tree: ThreadTree, threadId: string): ThreadTree {
    if (!tree.threads.has(threadId)) {
      console.error("Thread not found");
      return tree;
    }

    const updatedTree = {
      ...tree,
      activeThreadId: threadId,
    };

    this.saveThreadTree(updatedTree);
    return updatedTree;
  }

  // Get the breadcrumb path for a thread
  static getThreadPath(tree: ThreadTree, threadId: string): ThreadNode[] {
    const path: ThreadNode[] = [];
    let currentId: string | null = threadId;

    while (currentId) {
      const thread = tree.threads.get(currentId);
      if (!thread) break;
      path.unshift(thread);
      currentId = thread.parentId;
    }

    return path;
  }

  // Get all child threads of a parent
  static getChildThreads(tree: ThreadTree, parentId: string): ThreadNode[] {
    return Array.from(tree.threads.values()).filter(
      (thread) => thread.parentId === parentId
    );
  }

  // Get thread hierarchy for sidebar
  static getThreadHierarchy(tree: ThreadTree): ThreadNode[] {
    const mainThread = tree.threads.get(tree.mainThreadId);
    if (!mainThread) return [];

    const buildHierarchy = (parentId: string | null): ThreadNode[] => {
      const children = Array.from(tree.threads.values())
        .filter((thread) => thread.parentId === parentId)
        .sort((a, b) => b.timestamp - a.timestamp);

      const result: ThreadNode[] = [];
      for (const child of children) {
        result.push(child);
        result.push(...buildHierarchy(child.id));
      }
      return result;
    };

    return [mainThread, ...buildHierarchy(tree.mainThreadId)];
  }

  // Update thread messages
  static updateThreadMessages(
    tree: ThreadTree,
    threadId: string,
    messages: any[]
  ): ThreadTree {
    const thread = tree.threads.get(threadId);
    if (!thread) return tree;

    const updatedThread = { ...thread, messages };
    const updatedThreads = new Map(tree.threads);
    updatedThreads.set(threadId, updatedThread);

    const updatedTree = {
      ...tree,
      threads: updatedThreads,
    };

    this.saveThreadTree(updatedTree);
    return updatedTree;
  }

  // Delete a thread and all its children
  static deleteThread(tree: ThreadTree, threadId: string): ThreadTree {
    if (threadId === tree.mainThreadId) {
      console.error("Cannot delete main thread");
      return tree;
    }

    const toDelete = new Set<string>([threadId]);
    const findChildren = (parentId: string) => {
      const children = this.getChildThreads(tree, parentId);
      children.forEach((child) => {
        toDelete.add(child.id);
        findChildren(child.id);
      });
    };
    findChildren(threadId);

    const updatedThreads = new Map(tree.threads);
    toDelete.forEach((id) => updatedThreads.delete(id));

    let activeThreadId = tree.activeThreadId;
    if (toDelete.has(activeThreadId)) {
      // Switch to parent or main thread
      const deletedThread = tree.threads.get(threadId);
      activeThreadId = deletedThread?.parentId || tree.mainThreadId;
    }

    const updatedTree = {
      ...tree,
      threads: updatedThreads,
      activeThreadId,
    };

    this.saveThreadTree(updatedTree);
    return updatedTree;
  }
}
