// npm run feedback:export — regenerates feedback/FEEDBACK.md from the database. Changes no data.
import { createDb } from "../src/server/db/client";
import { regenerateFeedbackFile } from "../src/server/feedback/exportFile";
import { repoRelative } from "../src/server/feedback/paths";
import { loadEnv } from "./env";

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const db = createDb(url);
try {
  console.log(repoRelative(await regenerateFeedbackFile(db)));
} finally {
  await db.destroy();
}
