/**
 * The single email allowed to sign in. Auth is locked to this address — nobody
 * else can log in, even though Supabase magic-link auth is open by default.
 *
 * Set NEXT_PUBLIC_ALLOWED_EMAIL in your environment (.env.local and your host).
 * It's read client-side (the login page blocks other addresses before sending a
 * link) and server-side (page.tsx / the parse route force-sign-out mismatches),
 * so it must use the NEXT_PUBLIC_ prefix.
 *
 * If unset, the app fails closed — no email matches the empty string, so nobody
 * can sign in until you configure it. To support multiple users, turn this into
 * a list and adjust the equality checks.
 */
export const ALLOWED_EMAIL = (process.env.NEXT_PUBLIC_ALLOWED_EMAIL ?? '').trim().toLowerCase();
