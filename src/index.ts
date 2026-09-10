import { LuaAgent } from 'lua-cli';
import { persona } from './persona';
import { sampleIntakeSkill } from './skills/sample-intake.skill';
import { dispatchLoggingSkill } from './skills/dispatch-logging.skill';
import { statusTrackingSkill } from './skills/status-and-tracking.skill';
import { resultsCaptureSkill } from './skills/results-capture.skill';
import { clientBookSkill } from './skills/client-book.skill';
import { consignmentsSkill } from './skills/consignments.skill';
import currentDatetime from './preprocessors/current-datetime.preprocessor';
// TEMP (2026-07-09): all jobs held aside while stabilizing the chat agent. Adding the three
// reminder jobs in the v1.0.5 push (activeVersion 3) coincided with the live agent losing ALL
// tool execution (every reply became a fabrication). Jobs are parked here — not deleted — so they
// can be re-introduced one at a time once the agent is confirmed healthy.
// import { dailyChaserJob } from './jobs/daily-chaser.job';
// import { courierAwbReminderJob } from './jobs/courier-awb-reminder.job';
// import { feedbackReminderJob } from './jobs/feedback-reminder.job';
// import { orderPlacedReminderJob } from './jobs/order-placed-reminder.job';
// 2026-07-29: client-email jobs, re-introduced ONE at a time per the protocol above —
// dispatch-notifier first; add clientFeedbackChaserJob only after a healthy soak
// (sandbox chat still executes tools, then ~1 day live).
import { dispatchNotifierJob } from './jobs/dispatch-notifier.job';
// import { clientFeedbackChaserJob } from './jobs/client-feedback-chaser.job';
// 2026-08-20 (feedback #29/#30): status-notifier drains the notifications_outbox queue
// (QC ping on new requests, trader pings on preparing/dispatched/AWB). Armed 2026-08-24
// after v26 soaked healthy, per the one-job-per-version protocol above.
import { statusNotifierJob } from './jobs/status-notifier.job';
// 2026-09-09 (round 6, log-first intake): details-chaser nudges the colleague asked for a client's missing
// delivery details every morning. Written and harness-tested with v52; REGISTER IT IN v53 only, after v52
// soaks healthy (one job per version). Uncomment both lines:
// import { detailsChaserJob } from './jobs/details-chaser.job';
// v54 (after v53 soaks): import { trackingSweepJob } from './jobs/tracking-sweep.job';
// v55 (after v54 soaks): import { pssScheduleSkill } from './skills/pss-schedule.skill';

// v56 (after v55 soaks) — the Beyers incident, round 6: the model reached for a platform share card
// (`prepare_share`, renders nothing on Teams) and the stale Unified.to Teams MCP (bound to Lua's own
// tenant: it listed "Lua Global Inc" channels and called Tommie unreachable). The integrations stay
// connected (decision 2026-09-10 — disconnecting is riskier); these tools are blocked in code instead.
// SDK type: GovernanceConfig (lua-cli 3.32.6, `rules.blockTools` = runtime tool names). Its OWN version,
// sandbox-soaked first: a July push once killed ALL tool execution — after `lua push`, run
// `lua chat -e sandbox` through a create + request_missing_details and confirm every tool still runs,
// and that "share a card with QC" is refused, before `lua version create`.
// Tool names — SEEN in `lua logs --type mcp` (2026-07-16, 2026-09-08):
//   microsoftteamsbot_list_messaging_channels, microsoftteamsbot_list_messaging_messages,
//   googlemail_list_messaging_messages
// The rest follow the Unified.to naming (<connection>_<verb>_messaging_<object>) for the scopes the
// microsoftteamsbot connection was granted (messaging_channel_read, messaging_message_read,
// messaging_message_write, messaging_event_read — `lua mcp list`); Gmail / Google Calendar are
// "MCP pending" (no server listed) and are covered by the same pattern in case one is activated.
// Blocking a name no tool carries is harmless; re-check `lua logs --type mcp` after the soak.
export const BLOCKED_PLATFORM_TOOLS = [
  'prepare_share',
  // microsoftteamsbot (Unified.to, connection 6a4e52af2daf5368226b3272)
  'microsoftteamsbot_list_messaging_channels', 'microsoftteamsbot_get_messaging_channel',
  'microsoftteamsbot_list_messaging_messages', 'microsoftteamsbot_get_messaging_message',
  'microsoftteamsbot_create_messaging_message', 'microsoftteamsbot_update_messaging_message',
  'microsoftteamsbot_remove_messaging_message',
  'microsoftteamsbot_list_messaging_events', 'microsoftteamsbot_get_messaging_event',
  // Gmail (connection 6a58c289a3292df31e868c23, MCP pending)
  'googlemail_list_messaging_channels', 'googlemail_get_messaging_channel',
  'googlemail_list_messaging_messages', 'googlemail_get_messaging_message',
  'googlemail_create_messaging_message', 'googlemail_update_messaging_message',
  'googlemail_remove_messaging_message',
  // Google Calendar (connection 6a58c2a7a3292df31e868cf6, MCP pending)
  'googlecalendar_list_calendar_calendars', 'googlecalendar_get_calendar_calendar',
  'googlecalendar_list_calendar_events', 'googlecalendar_get_calendar_event',
  'googlecalendar_create_calendar_event', 'googlecalendar_update_calendar_event',
  'googlecalendar_remove_calendar_event',
];
// v56: also flip GROUP_ASKS_ENABLED to true in src/lib/conversation.ts (the group-aware ask).

const agent = new LuaAgent({
  name: 'Sample-management-agent',
  persona: persona,
  model: 'anthropic/claude-sonnet-5',
  skills: [
    sampleIntakeSkill,
    dispatchLoggingSkill,
    statusTrackingSkill,
    resultsCaptureSkill,
    clientBookSkill,
    consignmentsSkill,
  ], // v55: …, consignmentsSkill, pssScheduleSkill]
  // Legacy reminder jobs stay parked — see note above. New jobs enter one per version:
  // dispatch-notifier and status-notifier live; client-feedback-chaser is next in line
  // (add it only after status-notifier soaks healthy).
  jobs: [dispatchNotifierJob, statusNotifierJob], // v53: [dispatchNotifierJob, statusNotifierJob, detailsChaserJob]
  // v54: [dispatchNotifierJob, statusNotifierJob, detailsChaserJob, trackingSweepJob]
  // The model has no clock — this stamps every message with the real current date/time
  // so "today", relative dates, and recorded dates are never guessed.
  preProcessors: [currentDatetime],
  // v56: governance: { mode: 'sdk', rules: { blockTools: BLOCKED_PLATFORM_TOOLS } },
});

async function main() {}

main().catch(console.error);
