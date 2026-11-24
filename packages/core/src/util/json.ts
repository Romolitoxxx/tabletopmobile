/** Any value that survives a JSON round trip unchanged. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Deep clone through JSON; used where a plain-data copy is required. */
export function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
