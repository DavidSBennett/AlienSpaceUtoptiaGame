-- ─────────────────────────────────────────────────────────────────────────
-- bootstrap_admin_invite.sql
--
-- ONE-TIME bootstrap. Run this AFTER both migrations (04, 05) and
-- BEFORE you try to register your first account.
--
-- It seeds a single admin-granting invite code. You'll use it once to
-- create your own account (which is immediately granted is_admin=1).
-- Then go to the admin panel (Session 2) and revoke this code so it
-- can never be reused.
--
-- ┌──────────────────────────────────────────────────────────────┐
-- │ CHANGE THIS CODE TO SOMETHING ONLY YOU KNOW BEFORE RUNNING.  │
-- │ Pick 12 characters, uppercase, letters + digits.             │
-- │ Don't share it. Don't commit it.                             │
-- └──────────────────────────────────────────────────────────────┘
--
-- The code below is a placeholder. The user_invite_codes.code column
-- accepts any 12-char string from your base32-ish alphabet — letters
-- A–Z (excluding I, L, O) and digits 2–9 (excluding 0, 1) — but the
-- bootstrap insert doesn't enforce that, so go ahead and use any
-- memorable 12-char run if you prefer.

INSERT INTO user_invite_codes
  (code, grants_admin, max_uses, note)
VALUES
  ('CHANGEMEPLEASE', 1, 1,
   'BOOTSTRAP: redeem once to create your admin account, then revoke immediately');
