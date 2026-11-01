/**
 * Make a search term literal for the search RPCs, which build
 * `ilike '%' || p_query || '%'`: there `%` and `_` are wildcards and `\` is the
 * escape character, so a member searching "100%" or "a_b" would get everything
 * that merely resembles it (and "_" matches every member). Escaping here keeps
 * the SQL untouched (the RPCs are plan-sensitive, see scale_query_plans), and
 * is applied where the argument objects are built, so every caller gets it.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}
