// Feature 12's AI operations (research R4). Adding one means a definition file here and an entry
// below; the executor (call.ts) never changes.
import { getAIProvider } from "../../ai";
import { FakeAIProvider } from "../../ai/fake";
import { drillDomain } from "./domain";
import { registerDrillFakes } from "./fakes";
import { drillLadder } from "./ladder";
import { drillOffer } from "./offer";
import { drillRound } from "./round";
import { drillVerdict } from "./verdict";

export { callOperation } from "./call";
export { drillDomain, drillLadder, drillOffer, drillRound, drillVerdict };

export const DRILL_OPERATIONS = [drillLadder, drillRound, drillVerdict, drillOffer, drillDomain];

let faked = false;

/** With the fake provider, every operation answers deterministically (research R16). Idempotent. */
export function installDrillFakes(): void {
  if (faked || !(getAIProvider() instanceof FakeAIProvider)) return;
  faked = true;
  registerDrillFakes(DRILL_OPERATIONS);
}

/** Restores the fakes after a test replaced one with its own responder. */
export function resetDrillFakes(): void {
  registerDrillFakes(DRILL_OPERATIONS);
}
