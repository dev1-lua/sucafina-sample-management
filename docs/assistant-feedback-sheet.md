# Assistant feedback → Google Sheet

What colleagues say **about the bot** (not a client's feedback on a sample) is captured verbatim by
`capture_assistant_feedback`, kept in the agent's Lua Data collections
(`assistant_feedback_sessions`, `assistant_feedback_entries`), and mirrored to a Google Sheet — one row
per entry — **the moment it is captured**. The whole session is pushed again when it closes (30 min idle,
or the nightly job) as a repair for any live push that failed. The Sheet is a **mirror, never the record**: a failed push
leaves `sheet_pushed:false` and the nightly `assistant-feedback-flush` job retries it.

Code: `src/lib/assistant-feedback/`, `src/preprocessors/feedback-gate.preprocessor.ts`,
`src/postprocessors/tag-guard.postprocessor.ts`, `src/jobs/assistant-feedback-flush.job.ts`,
ops in `scripts/assistant-feedback.mts`.

> This repo is public. The webhook URL, the secret and the Sheet id live ONLY in `.env` (gitignored) and
> in the agent's platform env — never in this file.

## The flag (ships dark)

Row `{ key: 'assistant_feedback_enabled', value }` in the `config` Data collection:
`true` = everyone · `["someone@sucafina.com"]` = pilot · anything else = dark. No redeploy to change it:

```
npx tsx scripts/assistant-feedback.mts status | allow <emails> | on | off
```

`off` is the instant rollback: the model may still call the tool, which answers `disabled` and writes
nothing; already-open sessions still drain.

## Env

```
FEEDBACK_SHEET_WEBHOOK_URL   the Apps Script /exec URL
FEEDBACK_SHEET_SECRET        48-hex shared secret, byte-identical to SECRET in the script
```

Set in `.env` (for the ops script) **and** on the platform (`lua env`). Re-list the platform env after
every `lua push` and check the older keys survived. "Set" is not "delivered": the proof the runtime got
them is a closed session row with `sheet_pushed: true`; `sheet_push_error: "not_configured"` means it
didn't.

## The Sheet

Tab named exactly `Feedback`. Never type the headers — `op:'setupV2'` writes them:

`date | time | name | email | role | channel | category | feedback | session_id | entry_id`

The last two are machine plumbing. `entry_id` is the dedupe key (found by header name): every push is
idempotent and appends only entries not already in the Sheet.

## The Apps Script (Extensions → Apps Script, bound to the Sheet)

```javascript
/**
 * Assistant-feedback webhook — one sheet row per feedback entry, deduped PER ENTRY.
 *
 * POST JSON { secret, session_id, name, email, role, channel,
 *             entries: [ { id, date, time, category, feedback }, ... ] }
 * Replies   { ok:true, appended:N, dedup:bool } | { ok:false, error:"..." }
 *
 * Every push is idempotent: entries whose id is already in the entry_id column are skipped and only
 * the missing ones are appended. So the agent pushes each entry the moment it is captured, and pushes
 * the whole session again at close as a repair — both are safe. An entry without an id gets
 * "<session_id>#<index>".
 *
 * Maintenance ops (secret-gated, curl-able — the editor's Run UI is never needed):
 *   { secret, op:'setupV2' }      → (re)write headers + formatting. DESTRUCTIVE: clears the rows.
 *   { secret, op:'cleanupSmoke' } → delete rows whose session_id starts 'smoke-'
 */
var SECRET = 'PASTE-YOUR-48-HEX-SECRET-HERE';
var TAB = 'Feedback';
var HEADERS = ['date', 'time', 'name', 'email', 'role', 'channel', 'category', 'feedback', 'session_id', 'entry_id'];

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    if (p.secret !== SECRET) return json_({ ok: false, error: 'unauthorized' });

    if (p.op === 'setupV2') { setupV2(); return json_({ ok: true, did: 'setupV2' }); }
    if (p.op === 'cleanupSmoke') { cleanupSmoke(); return json_({ ok: true, did: 'cleanupSmoke' }); }

    // A wrong-shape push must fail HERE — no row written, nothing recorded — so the correct retry
    // can still land.
    if (typeof p.session_id !== 'string' || p.session_id === '' || !Array.isArray(p.entries)) {
      return json_({ ok: false, error: 'bad_payload' });
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB);
      var col = col_(sh, 'entry_id', HEADERS.length);
      var last = sh.getLastRow();
      var seen = {};
      if (last > 1) {
        var ids = sh.getRange(2, col, last - 1, 1).getValues();
        for (var i = 0; i < ids.length; i++) seen[String(ids[i][0])] = true;
      }
      var rows = [];
      for (var j = 0; j < p.entries.length; j++) {
        var en = p.entries[j] || {};
        var id = (typeof en.id === 'string' && en.id !== '') ? en.id : p.session_id + '#' + j;
        if (seen[id]) continue;
        seen[id] = true;
        rows.push([str_(en.date), str_(en.time), str_(p.name), str_(p.email), str_(p.role),
                   str_(p.channel), str_(en.category), str_(en.feedback), p.session_id, id]);
      }
      if (rows.length > 0) {
        sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
      }
      return json_({ ok: true, appended: rows.length, dedup: rows.length === 0 && p.entries.length > 0 });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** A column found by HEADER NAME (row 1), so columns can be reordered without breaking dedupe. */
function col_(sh, name, fallback) {
  var hdr = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var idx = hdr.indexOf(name);
  return idx === -1 ? fallback : idx + 1;
}

/** Text only, and never a formula: feedback is typed by people. */
function str_(v) {
  var s = v == null ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** ONE-TIME setup / restructure. Rerunnable but DESTRUCTIVE. */
function setupV2() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB) || ss.insertSheet(TAB);
  sh.clearContents();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange('A2:B').setNumberFormat('@');   // date + time stay TEXT exactly as sent
  var widths = [90, 55, 170, 210, 70, 70, 120, 440, 150, 110];
  for (var i = 0; i < widths.length; i++) sh.setColumnWidth(i + 1, widths[i]);
  sh.getRange('H2:H').setWrap(true);          // feedback text wraps
}

/** Deletes rows whose session_id starts with 'smoke-' (bottom-up). */
function cleanupSmoke() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB);
  var col = col_(sh, 'session_id', HEADERS.length - 1);
  var last = sh.getLastRow();
  if (last < 2) return;
  var ids = sh.getRange(2, col, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]).indexOf('smoke-') === 0) sh.deleteRow(i + 2);
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
```

## Deploying it

Deploy → New deployment → gear → **Web app** · Execute as **Me** · Who has access **Anyone** ("Anyone"
means no Google login; the shared secret is the authentication). Authorize (Advanced → Go to … → Allow).
The URL ending `/exec` is `FEEDBACK_SHEET_WEBHOOK_URL`.

**Editing the script later:** Deploy → **Manage deployments → pencil → Version: New version → Deploy**.
That keeps the URL. "New deployment" mints a NEW url and the agent keeps posting to the old code.

**Changing the columns later:** script first (`setupV2`, new version), then the agent version. The
other order lets the old script write blank rows and poison the dedupe column.

## Smoke tests

`curl -L -d` — **never `-X POST`**: `/exec` answers 302, and forcing POST onto the redirect returns an
HTML "Page not found" even though the row WAS written.

```bash
URL='https://script.google.com/macros/s/XXXX/exec'; S='YOUR-SECRET'
post() { curl -sL "$URL" -H 'Content-Type: application/json' -d "$1"; echo; }

post '{"secret":"'$S'","op":"setupV2"}'                      # {"ok":true,"did":"setupV2"}
V='{"secret":"'$S'","session_id":"smoke-1","name":"Smoke Tester","email":"smoke@example.test","role":"qc","channel":"teams","entries":[{"date":"2026-09-18","time":"10:15","category":"praise","feedback":"first line"},{"date":"2026-09-18","time":"10:16","category":"bug","feedback":"=second line"}]}'
post "$V"                                                     # {"ok":true,"appended":2}
post "$V"                                                     # {"ok":true,"dedup":true}
post '{"secret":"'$S'","session_id":"smoke-2","feedback_text":"flat shape"}'   # {"ok":false,"error":"bad_payload"}
post '{"secret":"wrong","session_id":"smoke-3","entries":[]}'                  # {"ok":false,"error":"unauthorized"}
post '{"secret":"'$S'","op":"cleanupSmoke"}'                  # {"ok":true,"did":"cleanupSmoke"}
```

## Go-live order

1. Sheet + script deployed, smoke tests pass, smoke rows cleaned.
2. Env set locally and on the platform; older platform keys still listed.
3. `npm test`, `lua compile` — version A adds exactly 4 primitives (skill, tool, preprocessor, postprocessor).
4. Push + `lua version create`, `lua version diff` against the active version. **Do not promote yet.**
5. Sandbox dark probe (flag absent): say something about the bot → log shows
   `{"diag":"capture_feedback","action":"disabled_dark"}`, `readstate` shows 0/0, the reply says nothing
   about feedback. Also confirm both preprocessors logged on the one message.
6. Promote. Same probe in prod.
7. `allow <your email>` → capture, append, wait 30 min + send a message → session `closed`,
   `sheet_pushed:true`, rows in the Sheet. Third ordinary turn ends with one invite line, no visible tag.
8. Must NOT capture: "Beyers sent their feedback on the PSS", "that AWB is wrong", "the status didn't
   update", "DHL lost it again", "why is SL-7459 still preparing". Any that does → add that sentence to
   the persona as a negative example.
9. `cleanup-tests <your email>`, `readstate` shows 0/0 → `on`. Tell the team the invite line is coming.
10. Version B after a healthy soak: register `assistantFeedbackFlushJob` in `src/index.ts`.

Known and accepted: until version B, a session closes only when its sender next writes (30 min idle);
the same person on Teams and email is two user records, so two sessions.
