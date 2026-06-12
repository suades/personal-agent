/**
 * Single source of truth for the allowed user email.
 * Auth is locked to this email only — nobody else can log in.
 *
 * DECISION: We keep Supabase magic-link auth (more secure than a password,
 * no credentials to leak, RLS works automatically) but restrict it to one email.
 * If you ever want to add more users, just turn this into an array.
 */
export const ALLOWED_EMAIL = 'suadesai17@gmail.com';
