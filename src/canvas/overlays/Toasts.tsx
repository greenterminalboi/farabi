"use client";

import { useEffect, useState } from "react";

/** Errors from frame buttons and drags (a Retry that failed, a move the server refused). */
export function Toasts() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (e: Event) => {
      setMessage((e as CustomEvent<{ message: string }>).detail.message);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 5000);
    };
    window.addEventListener("farabi:element-error", show);
    return () => {
      window.removeEventListener("farabi:element-error", show);
      clearTimeout(timer);
    };
  }, []);
  if (!message) return null;
  return (
    <div className="toast" role="alert" data-testid="canvas-error" onClick={() => setMessage(null)}>
      {message}
    </div>
  );
}
