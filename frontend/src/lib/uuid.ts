// A route id is user-controlled text that ends up in a uuid-typed RPC
// parameter. Check the shape first and 404, rather than letting Postgres
// raise 22P02 for every typo or probe.
//
// Deliberately permissive about version/variant bits (the nil uuid and
// non-RFC ids are still well-formed uuids as far as Postgres is concerned)
// and strict about everything else: `$` alone would accept a trailing
// newline, so the whole string is tested with \z-equivalent anchoring via
// length first.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && v.length === 36 && UUID.test(v);
}
