// The user's review of a function output (FR-050, FR-051). Each action appends a row to
// output_reviews; the newest wins and nothing is rewritten (Articles I and II).
import type { OutputResponse, Review } from "@/shared/schemas";
import { db } from "../db/client";
import { ConflictError } from "../errors";
import { loadLive, outputReview, toElement } from "../graph/elements";
import { assertId } from "../ids";

async function review(outputId: string, kind: Exclude<Review, "proposed">): Promise<OutputResponse> {
  assertId(outputId, "Output");
  return db.transaction().execute(async (trx) => {
    const output = await loadLive(trx, outputId);
    if (output.origin !== "run" || output.shape !== "node") {
      throw new ConflictError("wrong_kind", "Only a function output can be reviewed", { kind: output.kind });
    }
    // Serialize reviews of one output.
    await trx.selectFrom("nodes").select("id").where("id", "=", outputId).forUpdate().execute();
    if ((await outputReview(trx, outputId)) === kind) {
      throw new ConflictError(`already_${kind}`, kind === "confirmed" ? "This is already confirmed" : "This is already rejected");
    }
    await trx
      .insertInto("output_reviews")
      .values({ node_id: outputId, kind, provenance: kind === "confirmed" ? "user_confirmed" : "user_authored" })
      .execute();
    return { output: toElement(output, { review: kind }) };
  });
}

/** The user vouches for an output. Confirming a rejected output brings it back. */
export const confirmOutput = (outputId: string) => review(outputId, "confirmed");

/** Hides the output, and its edge when no visible output remains; the record stays (FR-050). */
export const rejectOutput = (outputId: string) => review(outputId, "rejected");
