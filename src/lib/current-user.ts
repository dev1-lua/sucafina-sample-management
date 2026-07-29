import { User } from 'lua-cli';

/**
 * Name of the human chatting with the agent (Teams profile full name), used to
 * default requested_by / completed_by on sample rows. Never throws — record
 * creation must not fail because the profile lookup did.
 */
export async function currentUserName(): Promise<string | null> {
  try {
    const user = await User.get();
    const name = user?._luaProfile?.fullName?.trim();
    return name || null;
  } catch {
    return null;
  }
}
