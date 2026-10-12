import { type Database, users } from '@app/db';
import { eq } from 'drizzle-orm';

// Env lists of addresses, read on every call, so the tests can switch them
const envList = (name: string) => (process.env[name] ?? '').split(',').map((entry) => entry.trim().toLowerCase());

// Prototypes stay closed until Robin opens them (README, „Registrierung öffnen“):
// existing accounts log in, new ones only for SIGNUP_ALLOWLIST until SIGNUP_OPEN=true.
export async function mayLogIn(db: Database, email: string) {
  if (process.env.SIGNUP_OPEN === 'true') return true;
  if (envList('SIGNUP_ALLOWLIST').includes(email)) return true;
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return !!user;
}

// Admins invite testers past the closed sign-up. Savor's test account stays
// out of ADMIN_EMAILS, so agents can't create accounts or mail third parties.
export function isAdmin(email: string) {
  return envList('ADMIN_EMAILS').includes(email);
}
