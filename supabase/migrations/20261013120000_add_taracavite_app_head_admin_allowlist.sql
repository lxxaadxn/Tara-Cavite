-- Add the head admin email to the admin allowlist.
-- Run via: supabase db push (or paste into the Supabase SQL Editor).
-- NOTE: seeding this email also blocks tourist signup with it (see is_cavitour_admin_email usage).

INSERT INTO public.cavitour_admin_allowlist (email)
VALUES ('taracavite.app@gmail.com')
ON CONFLICT (email) DO NOTHING;

-- Verify:
-- SELECT * FROM public.cavitour_admin_allowlist ORDER BY email;
