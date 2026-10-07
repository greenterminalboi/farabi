import type { Metadata } from "next";
import { ProjectMenu } from "@/components/common/ProjectMenu";
import { SettingsLink } from "@/components/common/SettingsLink";
import { TopNav } from "@/components/common/TopNav";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";
import { FeedbackDrawer } from "@/components/feedback/FeedbackDrawer";
import "@fontsource/opendyslexic/400.css";
import "@fontsource/opendyslexic/400-italic.css";
import "@fontsource/opendyslexic/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farabi",
  description: "Branching conversations on one canvas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <span className="brand">Farabi</span>
          <ProjectMenu />
          <TopNav />
          <SettingsLink />
          <FeedbackButton />
        </header>
        <main className="main">
          {children}
          <FeedbackDrawer />
        </main>
      </body>
    </html>
  );
}
