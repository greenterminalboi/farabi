// Global reply settings (Feature 6, research R3). Each change is a new user-authored row; the
// newest row per key is in effect, so history is never overwritten (FR-013, FR-020, Article VI).
import { isReplyModelChoice, REPLY_MODELS, type ReplyModelChoice } from "@/shared/models";
import { DEFAULT_PRESSURE, MAX_PRESSURE, MIN_PRESSURE } from "@/shared/pressure";
import type { SettingsResponse } from "@/shared/schemas";
import { db, type DB, type Trx } from "../db/client";
import type { SettingKey } from "../db/schema";
import { InvalidRequestError } from "../errors";

export type Settings = { informationPressure: number; replyModel: ReplyModelChoice };

async function latest(q: DB | Trx, key: SettingKey): Promise<unknown> {
  const row = await q
    .selectFrom("setting_changes")
    .select("value")
    .where("key", "=", key)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.value;
}

/** The settings in effect: the newest change per key, or the defaults (FR-004, FR-016). */
export async function getSettings(q: DB | Trx = db): Promise<Settings> {
  const [pressure, model] = await Promise.all([latest(q, "information_pressure"), latest(q, "reply_model")]);
  return {
    informationPressure: typeof pressure === "number" ? pressure : DEFAULT_PRESSURE,
    // A model no longer offered reads as "default" (spec edge case).
    replyModel: isReplyModelChoice(model) ? model : "default",
  };
}

export async function settingsResponse(): Promise<SettingsResponse> {
  return { ...(await getSettings()), models: REPLY_MODELS.map((m) => ({ id: m.id, label: m.label })) };
}

/** Records each changed setting as a new row; unchanged values write nothing. */
export async function saveSettings(patch: { informationPressure?: number; replyModel?: string }): Promise<SettingsResponse> {
  const { informationPressure, replyModel } = patch;
  if (informationPressure === undefined && replyModel === undefined) throw new InvalidRequestError("Nothing to save");
  if (
    informationPressure !== undefined &&
    (!Number.isInteger(informationPressure) || informationPressure < MIN_PRESSURE || informationPressure > MAX_PRESSURE)
  ) {
    throw new InvalidRequestError(`The level must be a whole number from ${MIN_PRESSURE} to ${MAX_PRESSURE}`);
  }
  if (replyModel !== undefined && !isReplyModelChoice(replyModel)) {
    throw new InvalidRequestError(`Unknown model "${replyModel}"`);
  }
  await db.transaction().execute(async (trx) => {
    const current = await getSettings(trx);
    const rows: Array<{ key: SettingKey; value: string }> = [];
    if (informationPressure !== undefined && informationPressure !== current.informationPressure) {
      rows.push({ key: "information_pressure", value: JSON.stringify(informationPressure) });
    }
    if (replyModel !== undefined && replyModel !== current.replyModel) {
      rows.push({ key: "reply_model", value: JSON.stringify(replyModel) });
    }
    if (rows.length) await trx.insertInto("setting_changes").values(rows).execute();
  });
  return settingsResponse();
}
