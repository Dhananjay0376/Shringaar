-- The previous hardening pass revoked EXECUTE from `anon` and `authenticated`, which did nothing:
-- Postgres grants EXECUTE on a new function to PUBLIC, and both roles inherit it from there. The
-- remaining `=X/postgres` entry in the ACL is PUBLIC. Revoking from PUBLIC is the grant that counts.
--
-- This is safe for the trigger: Postgres does not check the invoking role's EXECUTE privilege when
-- it fires a trigger, so `on_auth_user_created` keeps working while the function stops being
-- reachable as `/rest/v1/rpc/handle_new_user`.
revoke execute on function public.handle_new_user() from public;
