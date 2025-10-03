"use client";

import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessage, type AppendMessage } from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import { Separator } from "@/components/ui/separator";
import { useThreadBranching } from "@/hooks/use-thread-branching";
import { BranchButton } from "@/components/assistant-ui/branch-button";
import { ThreadBreadcrumbs } from "@/components/assistant-ui/thread-breadcrumbs";
import { useState, useCallback, useEffect, useRef } from "react";

const AssistantContent = () => {
  const {
    threadPath,
    threadHierarchy,
    activeThread,
    selectedText,
    showBranchButton,
    selectionPosition,
    createBranch,
    switchThread,
    deleteThread,
    updateMessages,
    handleTextSelection,
    clearSelection,
  } = useThreadBranching();

  const [isRunning, setIsRunning] = useState(false);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load messages when active thread changes
  useEffect(() => {
    if (activeThread) {
      console.log("Loading thread:", activeThread.id, "Messages:", activeThread.messages?.length || 0);
      // Ensure all messages have required properties
      const messagesWithDefaults = (activeThread.messages || []).map(msg => ({
        ...msg,
        attachments: msg.attachments || [],
        metadata: msg.metadata || (msg.role === 'assistant' ? { unstable_state: null } : undefined),
      }));
      setMessages(messagesWithDefaults as ThreadMessage[]);
    }
  }, [activeThread?.id]);

  // Save messages back to thread manager when they change
  useEffect(() => {
    if (activeThread && messages.length > 0) {
      updateMessages(messages);
    }
  }, [messages, activeThread?.id]);

  const onNew = useCallback(async (message: AppendMessage) => {
    console.log("onNew called with message:", message);
    
    // Add user message
    const userMessage: ThreadMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: message.content as any,
      createdAt: new Date(),
      attachments: message.attachments || [],
    } as ThreadMessage;
    
    setMessages((prev) => [...prev, userMessage]);
    setIsRunning(true);

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      // Convert messages to the format expected by the API
      const apiMessages = [...messages, userMessage]
        .filter(msg => msg && msg.role && msg.content)
        .map(msg => ({
          role: msg.role,
          content: Array.isArray(msg.content) 
            ? msg.content.map(c => c.type === 'text' ? c.text : '').filter(Boolean).join('') 
            : String(msg.content || '')
        }))
        .filter(msg => msg.content); // Only include messages with content

      console.log("Sending to API:", apiMessages);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          messages: apiMessages
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("API Error:", response.status, errorText);
        throw new Error(`API request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessageText = "";
      const assistantId = `assistant-${Date.now()}`;

      // Create initial assistant message
      const assistantMessage = {
        id: assistantId,
        role: "assistant",
        content: [{ type: "text", text: "" }],
        status: { type: "running" },
        createdAt: new Date(),
        metadata: {
          unstable_state: null,
        },
      } as unknown as ThreadMessage;
      
      setMessages((prev) => [...prev, assistantMessage]);

      // Stream the response using UIMessage format from Vercel AI SDK
      if (reader) {
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log("Stream complete, final text length:", assistantMessageText.length);
            // Mark message as complete
            setMessages((prev) => 
              prev.map((m) => 
                m.id === assistantId 
                  ? {
                      ...m,
                      status: { type: "complete", reason: "stop" },
                    }
                  : m
              )
            );
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          console.log("Raw chunk received, length:", chunk.length);
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue; // Skip empty lines
            
            console.log("Processing line:", line.substring(0, 100));
            
            try {
              // UIMessageStream format: "0:{json}\n" or "data: {json}\n"
              let jsonStr = line;
              
              if (line.startsWith("0:")) {
                jsonStr = line.slice(2);
              } else if (line.startsWith("data:")) {
                jsonStr = line.slice(5).trim();
                // Skip [DONE] marker
                if (jsonStr === "[DONE]") {
                  console.log("Stream done marker received");
                  continue;
                }
              } else if (line.startsWith(":")) {
                continue; // Skip comments
              }
              
              const data = JSON.parse(jsonStr);
              console.log("Parsed stream data type:", typeof data, "Keys:", Object.keys(data));
              console.log("Full parsed data:", JSON.stringify(data).substring(0, 200));
              
              // Handle different stream formats
              if (data.type === "text-delta" && data.delta !== undefined) {
                // Vercel AI SDK format - delta can be a string
                if (typeof data.delta === 'string') {
                  assistantMessageText += data.delta;
                  console.log("Added delta string, total length:", assistantMessageText.length);
                } else if (typeof data.delta === 'object' && data.delta !== null) {
                  // Delta as object with content/text property
                  if (data.delta.content) {
                    assistantMessageText += data.delta.content;
                    console.log("Added delta.content, total length:", assistantMessageText.length);
                  } else if (data.delta.text) {
                    assistantMessageText += data.delta.text;
                    console.log("Added delta.text, total length:", assistantMessageText.length);
                  }
                }
              } else if (data.content) {
                // Alternative format
                assistantMessageText += data.content;
                console.log("Added content, total length:", assistantMessageText.length);
              } else if (typeof data === 'string') {
                // Plain text format
                assistantMessageText += data;
                console.log("Added plain text, total length:", assistantMessageText.length);
              } else {
                console.log("Unhandled data format:", Object.keys(data));
              }
              
              // Update the message with accumulated text
              if (assistantMessageText) {
                setMessages((prev) => 
                  prev.map((m) => 
                    m.id === assistantId 
                      ? {
                          ...m,
                          content: [{ type: "text", text: assistantMessageText }],
                        }
                      : m
                  )
                );
              }
            } catch (e) {
              console.error("Failed to parse line:", line.substring(0, 100), e);
            }
          }
        }
        
        console.log("Final message text:", assistantMessageText.substring(0, 200));
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error("Error getting AI response:", error);
      }
    } finally {
      setIsRunning(false);
      abortControllerRef.current = null;
    }
  }, [messages]);

  const onCancel = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsRunning(false);
    }
  }, []);

  const onEdit = useCallback(async (message: AppendMessage) => {
    // Find the message being edited and remove everything after it
    const messageIndex = messages.findIndex(m => m.id === message.parentId);
    if (messageIndex === -1) return;
    
    const messagesUpToEdit = messages.slice(0, messageIndex + 1);
    
    // Add the edited message
    const editedMessage: ThreadMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: message.content as any,
      createdAt: new Date(),
      attachments: message.attachments || [],
    } as ThreadMessage;
    
    setMessages([...messagesUpToEdit, editedMessage]);
    setIsRunning(true);

    // Get AI response
    try {
      const apiMessages = [...messagesUpToEdit, editedMessage].map(msg => ({
        role: msg.role,
        content: Array.isArray(msg.content) 
          ? msg.content.map(c => c.type === 'text' ? c.text : '').join('') 
          : msg.content
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (!response.ok) throw new Error("API request failed");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessageText = "";
      const assistantId = `assistant-${Date.now()}`;

      const assistantMessage = {
        id: assistantId,
        role: "assistant",
        content: [{ type: "text", text: "" }],
        status: { type: "running" },
        createdAt: new Date(),
      } as unknown as ThreadMessage;
      
      setMessages(prev => [...prev, assistantMessage]);

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
                  assistantMessageText += data.content;
                  setMessages(prev => 
                    prev.map(m => 
                      m.id === assistantId 
                        ? { ...m, content: [{ type: "text", text: assistantMessageText }] }
                        : m
                    )
                  );
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Error getting AI response:", error);
    } finally {
      setIsRunning(false);
    }
  }, [messages]);

  const runtime = useExternalStoreRuntime({
    messages,
    setMessages: (newMessages) => setMessages([...newMessages]),
    isRunning,
    onNew,
    onEdit,
    onCancel,
  });

  const handleBranch = async (withQuestion?: string) => {
    console.log("Creating branch with", messages.length, "messages");
    const newThreadId = createBranch("current-message", withQuestion, messages);
    
    if (newThreadId) {
      console.log("✓ Branch created:", newThreadId);
      console.log("✓ Parent thread:", activeThread?.id);
      console.log("✓ Inherited", messages.length, "messages");
      console.log("✓ Selected text:", selectedText.substring(0, 50) + "...");
    }
  };

  const handleBranchFromMessage = () => {
    // Get the last assistant message for branching
    const lastAssistantMsg = [...messages].reverse().find(m => m.role === "assistant");
    if (lastAssistantMsg && lastAssistantMsg.content) {
      const content = lastAssistantMsg.content;
      const text = Array.isArray(content) && content[0]?.type === "text" 
        ? content[0].text 
        : "";
      
      if (text) {
        handleTextSelection(text, { x: 450, y: 300 });
      }
    }
  };

  const handleNewThread = () => {
    if (threadPath[0]) {
      switchThread(threadPath[0].id);
    }
  };

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SidebarProvider>
        <div className="flex h-dvh w-full pr-0.5">
          <ThreadListSidebar
            threadHierarchy={threadHierarchy}
            activeThreadId={activeThread?.id || ""}
            onSelectThread={switchThread}
            onDeleteThread={deleteThread}
            onNewThread={handleNewThread}
          />
          <SidebarInset>
            <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <ThreadBreadcrumbs
                threadPath={threadPath}
                onNavigate={switchThread}
              />
            </header>
            <div className="flex-1 overflow-hidden">
              <Thread 
                onTextSelection={handleTextSelection} 
                onBranchFromMessage={handleBranchFromMessage}
              />
            </div>
          </SidebarInset>
        </div>
        <BranchButton
          visible={showBranchButton}
          position={selectionPosition}
          selectedText={selectedText}
          onBranch={handleBranch}
          onClose={clearSelection}
        />
      </SidebarProvider>
    </AssistantRuntimeProvider>
  );
};

export const Assistant = () => {
  return <AssistantContent />;
};
