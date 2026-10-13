-- Admin allowlist: head admin taracavite.app@gmail.com + forcapstone111@gmail.com
-- Run in Supabase SQL Editor.
-- Password is NOT set here — create/update the Auth user in the Dashboard (see notes below).

-- Remove retired admin email
DELETE FROM public.cavitour_admin_allowlist
WHERE lower(email) = lower('forcapstone222@gmail.com');

-- Ensure current admins are present
INSERT INTO public.cavitour_admin_allowlist (email)
VALUES ('taracavite.app@gmail.com'),
       ('forcapstone111@gmail.com')
ON CONFLICT (email) DO NOTHING;

-- Verify:
-- SELECT * FROM public.cavitour_admin_allowlist ORDER BY email;

