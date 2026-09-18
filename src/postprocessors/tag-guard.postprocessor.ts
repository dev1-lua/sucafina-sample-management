import { PostProcessor } from 'lua-cli';

/**
 * tag-guard — machine-authored tags never reach the team. The persona bans echoing the
 * [feedback_nudge_due] tag (feedback-gate) and the [system context — …] stamp (current-datetime), but a
 * passive ban needs an active check. If another output rule is ever added to this chain, this strip
 * must stay FIRST: a rule that rewrites snake_case would hide a leaked tag from the regex.
 */
const SESSION_TAG_RE =
  /\[\s*(?:feedback_(?:mode|session_expired|nudge_due)[^\]]*|system context\s*[—–-][^\]]*)\][ \t]*\n?[ \t]*/gi;

export function stripSessionTags(response: string): string {
  return response.replace(SESSION_TAG_RE, '');
}

const tagGuard = new PostProcessor({
  name: 'tag-guard',
  description: 'Strips machine-authored tags ([feedback_nudge_due], the [system context — …] date stamp) from replies so they never reach the team',
  execute: async (_user, _message, response, _channel) => {
    try {
      const cleaned = stripSessionTags(response);
      // Never turn a reply into an empty one over a tag.
      return { modifiedResponse: cleaned.trim() ? cleaned : response };
    } catch {
      return { modifiedResponse: response };
    }
  },
});

export default tagGuard;
