import { NotFoundError } from "./errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route params that aren't UUIDs can't name an existing row. */
export function assertId(id: string, what: string): string {
  if (!UUID.test(id)) throw new NotFoundError(`${what} not found`);
  return id;
}
