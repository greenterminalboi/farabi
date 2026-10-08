/** Runs once when the server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Desktop app (feature 11): handshake with the shell, open and migrate the store, then report
  // ready. Start-up regenerates FEEDBACK.md itself once the store is open.
  if (process.env.FARABI_HOST === "tauri") {
    const { desktopStartup } = await import("@/server/db/startup");
    await desktopStartup();
    return;
  }
  // In a browser (`npm run dev:web`): the same data folder, brought up to date (with a backup)
  // before anything reads it, as the app does on start.
  try {
    const { prepareStore } = await import("@/server/db/startup");
    await prepareStore();
  } catch (err) {
    console.error("Could not open the data folder (FARABI_DATA_DIR).", err);
    return;
  }
  // Settings stored in the app take precedence over .env.local (feature 11).
  try {
    const { loadConfig } = await import("@/server/settings/config");
    await loadConfig();
  } catch (err) {
    console.error("Could not load stored settings; environment variables apply.", err);
  }
  // Make sure FEEDBACK.md reflects the data (research R6).
  try {
    const { regenerateFeedbackFile } = await import("@/server/feedback/exportFile");
    await regenerateFeedbackFile();
  } catch (err) {
    console.error("Could not regenerate FEEDBACK.md at start-up; it will be written on the next change.", err);
  }
}
