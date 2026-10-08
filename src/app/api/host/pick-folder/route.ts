import { pickFile, pickFolder } from "@/server/host/bridge";
import { readJson, withApi } from "@/server/http/withApi";
import { getConfig } from "@/server/settings/config";
import { PickFolderBody } from "@/shared/desktop";

const TITLES = {
  feedback_export: "Choose the folder for FEEDBACK.md",
  import_attachments: "Choose the web app's feedback folder",
  claude_code: "Choose the claude program",
} as const;

/** The native folder dialog, or a file dialog for the claude program (feature 11). `path` is null when cancelled. */
export const POST = withApi(async (req: Request) => {
  const { purpose } = await readJson(req, PickFolderBody);
  if (purpose === "claude_code") return Response.json({ path: await pickFile({ title: TITLES[purpose] }) });
  const current = purpose === "feedback_export" ? getConfig("feedback_export_dir") : null;
  const path = await pickFolder({ title: TITLES[purpose], ...(current ? { defaultPath: current } : {}) });
  return Response.json({ path });
});
