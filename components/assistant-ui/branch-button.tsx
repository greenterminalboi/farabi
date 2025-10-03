"use client";

import { FC, useEffect, useRef, useState } from "react";
import { GitBranchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface BranchButtonProps {
  visible: boolean;
  position: { x: number; y: number };
  selectedText: string;
  onBranch: (withQuestion?: string) => void;
  onClose: () => void;
}

export const BranchButton: FC<BranchButtonProps> = ({
  visible,
  position,
  selectedText,
  onBranch,
  onClose,
}) => {
  const [showDialog, setShowDialog] = useState(false);
  const [question, setQuestion] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!visible) {
      setShowDialog(false);
      setQuestion("");
    }
  }, [visible]);

  const handleBranchClick = () => {
    setShowDialog(true);
  };

  const handleBranchNow = () => {
    onBranch();
    setShowDialog(false);
    setQuestion("");
  };

  const handleBranchWithQuestion = () => {
    if (question.trim()) {
      onBranch(question.trim());
    } else {
      onBranch();
    }
    setShowDialog(false);
    setQuestion("");
  };

  if (!visible) return null;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleBranchClick}
        className="fixed z-50 flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-lg transition-all hover:bg-primary/90"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          transform: "translate(-50%, -100%) translateY(-8px)",
        }}
      >
        <GitBranchIcon className="size-4" />
        Branch from this
      </button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Create Branch</DialogTitle>
            <DialogDescription>
              Branch the conversation from the selected text. You can add a
              question or branch immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Selected Text:</label>
              <div className="rounded-md border bg-muted p-3 text-sm">
                {selectedText.length > 150
                  ? `${selectedText.substring(0, 150)}...`
                  : selectedText}
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="question" className="text-sm font-medium">
                Add a question (optional):
              </label>
              <Input
                id="question"
                placeholder="Ask a follow-up question about this text..."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleBranchWithQuestion();
                  }
                }}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowDialog(false);
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button variant="secondary" onClick={handleBranchNow}>
              Branch Without Question
            </Button>
            <Button onClick={handleBranchWithQuestion}>
              {question.trim() ? "Branch With Question" : "Branch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
