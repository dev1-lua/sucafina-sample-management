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
  ],
  // jobs parked — see note above. Restore incrementally after the agent is verified healthy.
  jobs: [],
  // The model has no clock — this stamps every message with the real current date/time
  // so "today", relative dates, and recorded dates are never guessed.
  preProcessors: [currentDatetime],
});

async function main() {}

main().catch(console.error);
