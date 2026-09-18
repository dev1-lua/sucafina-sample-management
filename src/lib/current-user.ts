import { User } from 'lua-cli';
import { nameFromEmail } from './names';

/**
 * The human chatting with the agent, from the Teams profile. Never throws — record creation must
 * not fail because the profile lookup did (outside the Lua runtime, e.g. the harnesses, both are null).
 * Name falls back to the email's local part ("harriet.muthoni@…" → "Harriet Muthoni"): one QC user's
 * Teams profile carries no fullName and her rows were landing with logged_by = null.
 */
export async function currentUser(): Promise<{ name: string | null; email: string | null }> {
  // The local harnesses (scripts/*-harness.ts, LUA_LOCAL_HARNESS=1) run outside the Lua runtime: there is
  // no chatting user, and since lua-cli 3.32 User.get() spends ~6 s asking the platform before saying so.
  if (process.env.LUA_LOCAL_HARNESS === '1') return { name: null, email: null };
  try {
    return identityFromUser(await User.get());
  } catch {
    return { name: null, email: null };
  }
}

/** Name + email off an already-loaded user record (a preprocessor is handed one). Pure; never throws. */
export function identityFromUser(user: unknown): { name: string | null; email: string | null } {
  const p: any = (user as any)?._luaProfile ?? {};
  const emails: unknown = p.emailAddresses;
  const first: any = Array.isArray(emails) ? emails[0] : null;
  const email = (typeof first === 'string' ? first : first?.address ?? first?.email ?? null) as string | null;
  const cleanEmail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
  const fullName = typeof p.fullName === 'string' ? p.fullName.trim() : '';
  const name = fullName || (cleanEmail ? nameFromEmail(cleanEmail) : null);
  return { name: name || null, email: cleanEmail };
}

/** Name of the human chatting with the agent — used to default requested_by / completed_by / logged_by. */
export async function currentUserName(): Promise<string | null> {
  return (await currentUser()).name;
}

export async function currentUserEmail(): Promise<string | null> {
  return (await currentUser()).email;
}

/**
 * x-actor value for API writes: `agent:<Full Name>` when the Teams profile gives one, else `agent:chat`.
 * The API's change alerts (Harriet, round 6) use it to say WHO edited or deleted a request.
 */
export async function currentActor(): Promise<string> {
  const { name } = await currentUser();
  return name ? `agent:${name}` : 'agent:chat';
}
