"use client";

import { useCallback, useMemo, useState } from "react";
import { ThreadManager } from "./thread-manager";

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string | Array<{ type: string; text: string }>;
  createdAt?: Date;
}

export function useThreadRuntimeAdapter(
  activeThreadId: string,
  onMessagesUpdate: (messages: ThreadMessage[]) => void
) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const addMessage = useCallback(
    async (message: ThreadMessage) => {
      const newMessages = [...messages, message];
      setMessages(newMessages);
      onMessagesUpdate(newMessages);

      // If user message, trigger AI response
      if (message.role === "user") {
        setIsRunning(true);
        try {
          // Call OpenAI API
          const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: newMessages }),
          });

          if (!response.ok) throw new Error("API request failed");

          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          let assistantMessage = "";

          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value);
              const lines = chunk.split("\n");

              for (const line of lines) {
                if (line.startsWith("0:")) {
                  try {
                    const jsonStr = line.slice(2);
                    const data = JSON.parse(jsonStr);
                    if (data.content) {
                      assistantMessage += data.content;
                    }
                  } catch (e) {
                    // Skip invalid JSON
                  }
                }
              }
            }
          }

          // Add assistant response
          const responseMessage: ThreadMessage = {
            id: `msg-${Date.now()}`,
            role: "assistant",
            content: assistantMessage,
            createdAt: new Date(),
          };

          const updatedMessages = [...newMessages, responseMessage];
          setMessages(updatedMessages);
          onMessagesUpdate(updatedMessages);
        } catch (error) {
          console.error("Error getting AI response:", error);
        } finally {
          setIsRunning(false);
        }
      }
    },
    [messages, onMessagesUpdate]
  );

  const setThreadMessages = useCallback((newMessages: ThreadMessage[]) => {
    setMessages(newMessages);
  }, []);

  return {
    messages,
    isRunning,
    addMessage,
    setThreadMessages,
  };
}
