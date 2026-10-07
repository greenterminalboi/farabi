// Every migration, imported statically so each one resolves its own imports like any module (0010
// imports the v1 converter). `tests/unit/migration-list.test.ts` keeps this in step with the folder.
import type { Migration, MigrationProvider } from "kysely/migration";
import * as m0001 from "./migrations/0001_initial";
import * as m0002 from "./migrations/0002_workspace";
import * as m0003 from "./migrations/0003_feedback";
import * as m0004 from "./migrations/0004_projects";
import * as m0005 from "./migrations/0005_span_suggestions";
import * as m0006 from "./migrations/0006_information_pressure";
import * as m0007 from "./migrations/0007_parked_tangents";
import * as m0008 from "./migrations/0008_drop_span_suggestions";
import * as m0009 from "./migrations/0009_node_functions";
import * as m0010 from "./migrations/0010_message_graph";
import * as m0011 from "./migrations/0011_drill";

export const MIGRATIONS: Record<string, Migration> = {
  "0001_initial": m0001,
  "0002_workspace": m0002,
  "0003_feedback": m0003,
  "0004_projects": m0004,
  "0005_span_suggestions": m0005,
  "0006_information_pressure": m0006,
  "0007_parked_tangents": m0007,
  "0008_drop_span_suggestions": m0008,
  "0009_node_functions": m0009,
  "0010_message_graph": m0010,
  "0011_drill": m0011,
};

export const migrationProvider: MigrationProvider = { getMigrations: async () => MIGRATIONS };
