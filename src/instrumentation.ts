/** Runs once when the server starts: make sure FEEDBACK.md reflects the database (research R6). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { regenerateFeedbackFile } = await import("@/server/feedback/exportFile");
    await regenerateFeedbackFile();
  } catch (err) {
    console.error("Could not regenerate FEEDBACK.md at start-up; it will be written on the next change.", err);
  }
}
