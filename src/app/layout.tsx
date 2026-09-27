import type { Metadata } from "next";
import { NewConversationButton } from "@/components/common/NewConversationButton";
import { ViewToggle } from "@/components/common/ViewToggle";
import { MapHost } from "@/components/map/MapHost";
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
        </header>
        <main className="main">
          {children}
          <MapHost />
        </main>
      </body>
    </html>
  );
}
