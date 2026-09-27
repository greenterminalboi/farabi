import type { Metadata } from "next";
import { NewConversationButton } from "@/components/common/NewConversationButton";
import { ViewToggle } from "@/components/common/ViewToggle";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";
import { FeedbackDrawer } from "@/components/feedback/FeedbackDrawer";
import { MapHost } from "@/components/map/MapHost";
import "@fontsource/opendyslexic/400.css";
import "@fontsource/opendyslexic/400-italic.css";
import "@fontsource/opendyslexic/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farabi",
  description: "Branching conversations laid out as a map",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <span className="brand">Farabi</span>
          <ViewToggle />
          <NewConversationButton />
          <FeedbackButton />
        </header>
        <main className="main">
          {children}
          <MapHost />
          <FeedbackDrawer />
        </main>
      </body>
    </html>
  );
}
