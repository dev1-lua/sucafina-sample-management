import { LuaAgent } from 'lua-cli';
import { persona } from './persona';
import { sampleIntakeSkill } from './skills/sample-intake.skill';
import { dispatchLoggingSkill } from './skills/dispatch-logging.skill';
import { statusTrackingSkill } from './skills/status-and-tracking.skill';
import { resultsCaptureSkill } from './skills/results-capture.skill';
import { clientBookSkill } from './skills/client-book.skill';
import { dailyChaserJob } from './jobs/daily-chaser.job';
import { courierAwbReminderJob } from './jobs/courier-awb-reminder.job';
import { feedbackReminderJob } from './jobs/feedback-reminder.job';
import { orderPlacedReminderJob } from './jobs/order-placed-reminder.job';

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
  ],
  jobs: [dailyChaserJob, courierAwbReminderJob, feedbackReminderJob, orderPlacedReminderJob],
});

async function main() {}

main().catch(console.error);
