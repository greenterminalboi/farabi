import { drillAttemptKind } from "./attempt";
import { drillKind } from "./drill";
import { drillHintKind } from "./hint";
import { drillLessonKind } from "./lesson";
import { drillProblemKind } from "./problem";
import { drillRoundKind } from "./round";
import { drillSolutionKind } from "./solution";
import { drillStartKind } from "./start";
import { drillVerdictKind } from "./verdict";

/** Feature 12's kinds, in tree order (research R2). */
export const DRILL_KINDS = [
  drillStartKind,
  drillKind,
  drillRoundKind,
  drillLessonKind,
  drillProblemKind,
  drillHintKind,
  drillSolutionKind,
  drillAttemptKind,
  drillVerdictKind,
];
