"use client";

import type { FC } from "react";
import { useState } from "react";
import { PlusIcon, ChevronRightIcon, ChevronDownIcon, GitBranchIcon, TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { ThreadNode, ThreadManager } from "@/lib/thread-manager";
import { cn } from "@/lib/utils";

interface HierarchicalThreadListProps {
  threadHierarchy: ThreadNode[];
  activeThreadId: string;
  onSelectThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onNewThread: () => void;
}

export const HierarchicalThreadList: FC<HierarchicalThreadListProps> = ({
  threadHierarchy,
  activeThreadId,
  onSelectThread,
  onDeleteThread,
  onNewThread,
}) => {
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(new Set());

  const toggleCollapse = (threadId: string) => {
    setCollapsedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      return next;
    });
  };

  const getVisibleThreads = () => {
    const visible: Array<{ thread: ThreadNode; level: number }> = [];
    const mainThread = threadHierarchy[0];
    
    if (!mainThread) return visible;

    const addThread = (thread: ThreadNode, level: number, parentCollapsed: boolean) => {
      if (parentCollapsed) return;

      visible.push({ thread, level });

      const isCollapsed = collapsedThreads.has(thread.id);
      
      // Find and add children
      const children = threadHierarchy.filter((t) => t.parentId === thread.id);
      children.forEach((child) => {
        addThread(child, level + 1, isCollapsed);
      });
    };

    addThread(mainThread, 0, false);
    return visible;
  };

  const hasChildren = (threadId: string) => {
    return threadHierarchy.some((t) => t.parentId === threadId);
  };

  const visibleThreads = getVisibleThreads();

  return (
    <div className="flex flex-col items-stretch gap-1.5">
      <Button
        onClick={onNewThread}
        className="flex items-center justify-start gap-1 rounded-lg px-2.5 py-2 text-start hover:bg-muted"
        variant="ghost"
      >
        <PlusIcon className="size-4" />
        New Thread
      </Button>

      <div className="flex flex-col gap-0.5">
        {visibleThreads.map(({ thread, level }) => {
          const isActive = thread.id === activeThreadId;
          const hasChild = hasChildren(thread.id);
          const isCollapsed = collapsedThreads.has(thread.id);
          const bgColor = ThreadManager.getThreadColor(thread.depth);
          const borderColor = ThreadManager.getThreadBorderColor(thread.depth);

          return (
            <div
              key={thread.id}
              className={cn(
                "group relative flex items-center gap-1 rounded-lg transition-all hover:bg-muted",
                isActive && "bg-muted"
              )}
              style={{
                paddingLeft: `${level * 12 + 8}px`,
                backgroundColor: isActive ? bgColor : "transparent",
                borderLeft: level > 0 ? `2px solid ${borderColor}` : "none",
              }}
            >
              {/* Tree line connector for children */}
              {level > 0 && (
                <div
                  className="absolute left-0 top-0 bottom-0 w-px"
                  style={{
                    left: `${(level - 1) * 12 + 8}px`,
                    backgroundColor: borderColor,
                  }}
                />
              )}

              {/* Collapse/Expand button */}
              {hasChild ? (
                <button
                  onClick={() => toggleCollapse(thread.id)}
                  className="flex size-4 shrink-0 items-center justify-center rounded hover:bg-accent"
                >
                  {isCollapsed ? (
                    <ChevronRightIcon className="size-3" />
                  ) : (
                    <ChevronDownIcon className="size-3" />
                  )}
                </button>
              ) : (
                <div className="size-4 shrink-0" />
              )}

              {/* Branch icon for child threads */}
              {level > 0 && (
                <GitBranchIcon className="size-3 shrink-0 text-muted-foreground" />
              )}

              {/* Thread title */}
              <button
                onClick={() => onSelectThread(thread.id)}
                className="flex-grow truncate px-2 py-1.5 text-start text-sm"
                title={thread.title}
              >
                {thread.title}
              </button>

              {/* Delete button (hidden for main thread) */}
              {thread.parentId && (
                <TooltipIconButton
                  className="mr-2 size-4 shrink-0 p-0 opacity-0 transition-opacity group-hover:opacity-100"
                  variant="ghost"
                  tooltip="Delete branch"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteThread(thread.id);
                  }}
                >
                  <TrashIcon className="size-3" />
                </TooltipIconButton>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
