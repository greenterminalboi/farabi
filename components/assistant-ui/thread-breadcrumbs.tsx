"use client";

import { FC, Fragment } from "react";
import { ChevronRightIcon } from "lucide-react";
import { ThreadNode } from "@/lib/thread-manager";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface ThreadBreadcrumbsProps {
  threadPath: ThreadNode[];
  onNavigate: (threadId: string) => void;
}

export const ThreadBreadcrumbs: FC<ThreadBreadcrumbsProps> = ({
  threadPath,
  onNavigate,
}) => {
  if (threadPath.length === 0) return null;

  const displayPath = getCollapsedPath(threadPath);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {displayPath.map((item, index) => {
          const isLast = index === displayPath.length - 1;
          const isEllipsis = item.type === "ellipsis";

          return (
            <Fragment key={item.id || `ellipsis-${index}`}>
              <BreadcrumbItem>
                {isEllipsis ? (
                  <span className="text-muted-foreground">...</span>
                ) : isLast ? (
                  <BreadcrumbPage className="max-w-[200px] truncate">
                    {item.title}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    onClick={() => item.id && onNavigate(item.id)}
                    className="max-w-[200px] cursor-pointer truncate hover:text-foreground"
                  >
                    {item.title}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && (
                <BreadcrumbSeparator>
                  <ChevronRightIcon className="size-4" />
                </BreadcrumbSeparator>
              )}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
};

// Collapse breadcrumbs when there are too many levels
function getCollapsedPath(
  path: ThreadNode[]
): Array<{ id?: string; title: string; type?: "ellipsis" }> {
  const MAX_VISIBLE = 4;

  if (path.length <= MAX_VISIBLE) {
    return path.map((node) => ({
      id: node.id,
      title: getTruncatedTitle(node.title),
    }));
  }

  // Show: First, ..., Parent, Current
  const result = [
    {
      id: path[0].id,
      title: getTruncatedTitle(path[0].title),
    },
    {
      type: "ellipsis" as const,
      title: "...",
    },
    {
      id: path[path.length - 2].id,
      title: getTruncatedTitle(path[path.length - 2].title),
    },
    {
      id: path[path.length - 1].id,
      title: getTruncatedTitle(path[path.length - 1].title),
    },
  ];

  return result;
}

function getTruncatedTitle(title: string): string {
  const MAX_LENGTH = 30;
  if (title.length <= MAX_LENGTH) return title;
  return title.substring(0, MAX_LENGTH) + "...";
}
