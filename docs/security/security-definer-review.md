# Security Definer Review

This review covers the authenticated `public` functions previously flagged by the Supabase advisor. No Production catalog was queried and no database object is changed by this branch.

| Function class | Classification | Source review |
| --- | --- | --- |
| `is_workspace_member`, `workspace_member_role`, `has_workspace_role`, `can_manage_workspace`, `can_edit_operations` | Accepted intentional design | RLS recursion helpers derive identity from `auth.uid()`, use qualified relations, contain no dynamic SQL, and are executable by `authenticated` only. Their fixed `search_path = public` is safe with the current schema privilege model, though an empty path is preferred for future replacements. |
| `can_contribute_workspace` | Hygiene-complete intentional design | The HIGH remediation uses an empty search path, fully qualified objects, an exact role set, and authenticated-only execution. |
| `accept_workspace_invites_for_current_user` | Accepted intentional design | The function binds `auth.uid()` to the verified JWT email, activates only a matching pending invite, has no caller-supplied workspace identity, and is denied to `PUBLIC` and `anon`. |
| Authenticated document-extraction eligibility, intake, review, and authority RPCs | Accepted intentional API boundary | The functions require the authenticated user and exact workspace/file/intake/profile/version bindings. Internal trigger and mutation helpers are revoked from exposed roles. Worker mutation RPCs remain service-role-only. |
| Manual activation and Saved Analysis deletion | No definer exposure | The canonical functions are `SECURITY INVOKER`, use an empty search path, and retain their existing restricted grants. |

## Placement decision

Moving the RLS helpers to an unexposed schema would reduce advisor noise but would require a broad policy rewrite and grant migration without changing the effective caller authority. That is a hygiene improvement, not a demonstrated alternate access path, and is deferred from this non-blocking pass.

Any future `SECURITY DEFINER` function must start by revoking `EXECUTE` from `PUBLIC`, use an empty or fixed safe search path, fully qualify objects, avoid user-controlled dynamic SQL, derive identity from trusted Auth claims, and grant only the exact role that needs the function.
