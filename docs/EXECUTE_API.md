# Session Execute API

Run JavaScript inside a session's page and get back a structured result. Every
execution is tracked as a **job**, which gives you:

- Typed errors: `error_code` and `retryable`, plus `scriptStarted`.
- `await` support, with `args` and an abort `signal` passed to the script.
- Hard timeouts and cooperative cancellation.
- Background jobs for long scripts: the request returns `202` with a `jobId`, which you poll.
- Idempotency through a client-chosen `actionId`. The same action never runs twice.
- A per-session lock, so overlapping commands are rejected and never interleaved.
- Navigation detection armed before the script runs.
- Condition-based waits (visible / enabled / stable / unobscured / exact dropdown option).
- Frame targeting.
- Redacted failure evidence (screenshot, HTML, console errors, failed requests).

Base URL: `http://localhost:3000/api/session`

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/:sessionId/execute` | Run a script (creates a job) |
| `GET` | `/:sessionId/execute/:jobIdOrActionId` | Job status / result (supports long-polling) |
| `POST` | `/:sessionId/execute/:jobIdOrActionId/cancel` | Cancel a running job |
| `GET` | `/:sessionId` | Session info, now including `busy` and `activeOperation` |

---

## 1. Quick start

```bash
SID=$(curl -s -X POST localhost:3000/api/session/create -H 'Content-Type: application/json' \
  -d '{"headless": true}' | jq -r .sessionId)

curl -s -X POST localhost:3000/api/session/$SID/goto -H 'Content-Type: application/json' \
  -d '{"url": "https://www.google.com"}'

curl -s -X POST localhost:3000/api/session/$SID/execute -H 'Content-Type: application/json' \
  -d '{"script": "return document.title"}'
```

```json
{
  "success": true,
  "sessionId": "2e823cab-…",
  "jobId": "ca5c39bd-…",
  "status": "succeeded",
  "result": "Google",
  "scriptStarted": true,
  "urlBefore": "https://www.google.com/",
  "url": "https://www.google.com/",
  "navigated": false,
  "navigation": { "occurred": false, "requested": false, "committed": false, "readyState": "complete", "settled": true, "url": "https://www.google.com/" },
  "startedAt": "2026-11-20T05:24:51.406Z",
  "finishedAt": "2026-11-20T05:24:51.625Z",
  "durationMs": 219
}
```

---

## 2. Writing scripts

`script` is the **body of an async function**. Use `return` to send back a
value. The value must be JSON-serializable; DOM nodes come back as `{}`.

```js
// what actually runs in the page:
(async function (args, signal) {
  /* your script */
})
```

Two variables are in scope:

| Name | What it is |
|---|---|
| `args` | The request's `args` value (any JSON). Pass data in here instead of splicing it into the script string. This avoids quoting bugs and injection, and keeps secrets out of the script hash. |
| `signal` | An `AbortSignal`. It fires when the job times out (`signal.reason.name === "TimeoutError"`) or is cancelled (`"AbortError"`). Long scripts should listen to it and stop. |

```json
{
  "script": "const el = document.querySelector(args.selector); await new Promise(r => setTimeout(r, 200)); return el?.textContent.trim();",
  "args": { "selector": "h1" }
}
```

Cooperative cancellation example:

```js
for (const item of args.items) {
  if (signal.aborted) throw signal.reason;   // stop cleanly on timeout/cancel
  await doSomething(item);
}
return "done";
```

> **Compatibility:** existing scripts like `"return document.title"` work
> unchanged. Arrow-function strings like `"() => document.title"` never
> worked; they return `undefined`. Write the body instead.

---

## 3. Request body reference

`POST /:sessionId/execute`

| Field | Type | Default | Description |
|---|---|---|---|
| `script` | string | **required** | Async function body (see §2). |
| `args` | any JSON | `undefined` | Exposed to the script as `args`. |
| `actionId` | string (≤200 chars) | none | Idempotency key. See §6. |
| `timeout` | ms | `60000` (max `600000`) | Hard limit on the script's own run time. When it passes, the job fails with `TIMEOUT` and `signal` is aborted. Waits and navigation settling have their own timeouts. |
| `responseTimeout` | ms | wait until done | How long the HTTP request waits. If the job is still running after that, you get `202` and a `jobId` to poll. `0` returns immediately. |
| `frame` | object or string | main frame | Run in an iframe instead. See §8. |
| `waitFor` | object, string or array | none | Preconditions checked **before** the script runs. See §7. |
| `navigation.graceMs` | ms | `100` (max `5000`) | After the script returns, how long to watch for a navigation that it triggered but that hasn't started yet (e.g. a click on a submit button). |
| `navigation.waitUntil` | `"none"` \| `"commit"` \| `"domcontentloaded"` \| `"load"` | `"domcontentloaded"` | How far to let a detected navigation load before responding. |
| `navigation.timeout` | ms | `10000` (max `60000`) | Upper bound for navigation settling. If it runs out, `navigation.settled` is `false`. |
| `evidence` | `"on-failure"` \| `"always"` \| `"never"` | `"on-failure"` | When to attach failure evidence. See §9. |

Full example:

```json
{
  "script": "document.querySelector(args.btn).click(); return 'clicked'",
  "args": { "btn": "button[type=submit]" },
  "actionId": "listing-42-submit",
  "timeout": 20000,
  "responseTimeout": 25000,
  "waitFor": [
    { "selector": "button[type=submit]", "state": ["visible", "enabled", "stable", "unobscured"], "timeout": 10000 }
  ],
  "navigation": { "graceMs": 500, "waitUntil": "load", "timeout": 15000 },
  "evidence": "on-failure"
}
```

---

## 4. Response reference

The same shape comes back from `POST /execute`, `GET /execute/:id` and `POST …/cancel`.

| Field | When | Description |
|---|---|---|
| `success` | always | `true` only when `status === "succeeded"`. |
| `sessionId`, `jobId` | always | Identifiers. Poll with `jobId`. |
| `actionId` | if given | Echoed back. |
| `status` | always | `running` \| `succeeded` \| `failed` \| `cancelled` |
| `phase` | running | `queued`, `resolving-frame`, `waiting`, `compiling`, `running`, `settling-navigation` or `capturing-evidence` |
| `duplicate` | replays | `true` when this response is a stored result for a repeated `actionId`. |
| `result` | succeeded | The script's return value. |
| `error` | failed/cancelled | Always `"Failed to execute script"` (kept for older clients). |
| `error_code` | failed/cancelled | See §5. |
| `message` | failed/cancelled | Human-readable cause. |
| `retryable` | failed/cancelled | `true` only when **no page code ran**, so resending the identical request cannot duplicate a side effect. |
| `details` | some failures | E.g. the last element probe for `waitFor` failures, or `thrownValue` for `throw "string"`. |
| `scriptStarted` | always | Whether your script began executing. |
| `urlBefore` | always | Page URL when the job started (redacted). |
| `url` | always | Page URL at the end, after navigation settled (redacted). |
| `navigated` | always | Whether the main frame navigated during the job. This includes same-document (`pushState`) navigations. |
| `navigation` | finished | `{ occurred, requested, committed, aborted?, readyState, settled, url }`. `requested` means a navigation request was sent. `committed` means a new document (or same-document URL) took effect. `aborted` means the request ended without committing (204, download, blocked). `settled: false` means `navigation.timeout` ran out first. |
| `frameUrl` | with `frame` | URL of the targeted frame. |
| `waits` | with `waitFor` | `[{ target, states, option?, waitedMs }]` for each satisfied condition. |
| `startedAt`, `finishedAt`, `durationMs` | always | Timing. While the job is running, `durationMs` is the time so far. |
| `evidence` | per `evidence` | See §9. |

### HTTP status codes

| HTTP | Meaning |
|---|---|
| `200` | Succeeded. Also used for every `GET /execute/:id` poll; the job outcome is in the body. |
| `202` | Still running after `responseTimeout`. Poll the `jobId`. |
| `400` | `INVALID_REQUEST` |
| `404` | `SESSION_NOT_FOUND` / `JOB_NOT_FOUND` |
| `409` | `SESSION_BUSY`, `ACTION_ID_CONFLICT`, `CANCELLED`, `JOB_NOT_RUNNING` |
| `410` | `SESSION_CLOSED` |
| `422` | `SELECTOR_MISSING`, `CONDITION_NOT_MET` (precondition failed; script not run) |
| `500` | `SCRIPT_EXCEPTION`, `CONTEXT_DESTROYED`, `INTERNAL_ERROR` |
| `504` | `TIMEOUT` |

---

## 5. Error codes

| `error_code` | `retryable` | Script ran? | Meaning / what to do |
|---|---|---|---|
| `INVALID_REQUEST` | false | no | Bad body (missing `script`, unknown `waitFor.state`, …). Fix the request. |
| `SESSION_NOT_FOUND` | false | no | Unknown or expired session id. |
| `SESSION_CLOSED` | false | maybe | The session was closed. Either it closed during the job, or it closed earlier and you're polling a job from it (remembered for 1 h). |
| `SESSION_BUSY` | **true** | no | Another command holds the session lock (§10). Retry once `activeOperation` finishes. |
| `ACTION_ID_CONFLICT` | false | no | That `actionId` was already used with a different `script`/`args`. Use a new id. |
| `SELECTOR_MISSING` | **true** | no | A `waitFor` element or the `frame` never appeared. `details` lists what was tried. |
| `CONDITION_NOT_MET` | **true** | no | The element exists but never became visible/enabled/stable/unobscured, or the option never appeared. `details.lastProbe` shows the last observed state, e.g. `obscuredBy: "div#overlay"`. |
| `SCRIPT_EXCEPTION` | false | yes* | Your script threw. `message` keeps the JS error name (`TypeError: …`). *A `SyntaxError` is reported with `scriptStarted: false`, but retrying won't help. |
| `TIMEOUT` | false | yes | The script exceeded `timeout`. `signal` was aborted, but side effects may already have happened. **Inspect the page before doing anything else.** |
| `CONTEXT_DESTROYED` | false if `scriptStarted`, else true | yes/no | A navigation or frame detach destroyed the script's context. Usually the script itself caused it (clicked a link, submitted a form). **The script is never re-run.** Check `url` / `navigation` to see where the page ended up. |
| `CANCELLED` | false if `scriptStarted`, else true | yes/no | Cancelled via the cancel endpoint. |
| `INTERNAL_ERROR` | false | no | Unexpected server-side error before the script ran. |
| `JOB_NOT_FOUND` | — | — | Poll/cancel for an unknown id. Jobs are kept 30 min, at most 100 per session. |
| `JOB_NOT_RUNNING` | — | — | Cancel of an already finished job. The job is in the `job` field. |

**The retry rule:** retry automatically only when `retryable === true`.
Anything else means the script may already have clicked, submitted or paid.
Look at the page (screenshot, `/html`, or another read-only execute) before
deciding. The API never retries a script by itself.

**Your own outcomes stay in `result`.** These codes describe *execution* only.
Business outcomes are not errors. For example, a directory rejecting a
submission, or your safety logic choosing to stop. Return them from the script,
e.g. `return { outcome: "directory_rejected", reason }`, and handle them in
your client. Keep them separate from `error_code`.

---

## 6. Idempotency with `actionId`

Give every state-changing action a unique `actionId`, such as
`"<workflow>-<step>-<attempt>"`.

| Situation | What happens |
|---|---|
| First request with that `actionId` | Job runs normally. |
| Same `actionId` while that job is still running | Nothing new runs. You get the running job (`202`, or the final result if it finishes within `responseTimeout`) with `duplicate: true`. |
| Same `actionId` after it finished (success **or failure**) | Nothing runs. You get the stored outcome with `duplicate: true` and the original HTTP status. |
| Same `actionId` with a different `script`/`args` | `409 ACTION_ID_CONFLICT`; nothing runs. |

Recover from a lost response (client timeout, dropped connection, process
restart on the client side):

```bash
# Either re-send the exact same request: it returns the stored result.
# Or poll by actionId:
curl -s "localhost:3000/api/session/$SID/execute/listing-42-submit?wait=10000"
```

To deliberately run the action again after a failure, use a **new**
`actionId`, and only after you've confirmed the page state.

> Registration, payment and final-submit actions should always carry an
> `actionId`. This API never repeats them automatically. Don't build client
> logic that blindly re-sends them on `TIMEOUT`, `CONTEXT_DESTROYED` or a
> network error. Poll the `actionId` instead.

Jobs live in server memory. They are lost when the session closes or the API
restarts.

---

## 7. Condition-based waits (`waitFor`)

Preconditions are checked **before** your script runs, polling every 100 ms.
If one fails, the script never runs and the error is `retryable: true`.

```json
"waitFor": [
  { "selector": "#country", "option": { "text": "Armenia" } },
  { "selector": "button[type=submit]", "state": ["visible", "enabled", "stable", "unobscured"], "timeout": 15000 },
  { "xpath": "//h1[contains(., 'Checkout')]", "state": "attached" }
]
```

Shorthand: `"waitFor": "#submit"` means `{ "selector": "#submit", "state": "visible" }`.

| Field | Description |
|---|---|
| `selector` / `xpath` | Exactly one. Resolved in the target frame (§8). |
| `state` | String or array; default `"visible"`. All listed states must hold at the same time. |
| `option` | `{ "text": "…" }` and/or `{ "value": "…" }`, or a plain string meaning text. Requires an **exact** option to exist and be enabled. Text comparison trims and collapses whitespace. Works for `<select>` and for custom listboxes (`option`, `[role=option]` descendants, `data-value`/`value` attributes). |
| `timeout` | ms, default `10000`, max `120000`. |

| State | Holds when |
|---|---|
| `attached` | The element exists in the DOM. |
| `visible` | Non-zero size, not `visibility:hidden`, not `display:none`, not `opacity:0` (uses `checkVisibility()`). |
| `enabled` | Not `:disabled` (this includes a disabled `<fieldset>`), not `aria-disabled="true"`, not inside `[inert]`. |
| `stable` | Its bounding box is unchanged between two consecutive polls, so it isn't animating or shifting. |
| `unobscured` | Hit-testing its center point returns the element or one of its descendants (shadow DOM aware). Nothing such as an overlay, cookie banner or modal sits on top. An off-screen element is first scrolled into view. |

Failure example:

```json
{
  "status": "failed",
  "error_code": "CONDITION_NOT_MET",
  "message": "Element #covered did not become unobscured within 300ms (obscured by div#overlay); the script was not run",
  "retryable": true,
  "scriptStarted": false,
  "details": {
    "target": "#covered",
    "unmet": ["unobscured"],
    "lastProbe": { "found": true, "element": "button#covered", "visible": true, "unobscured": false, "obscuredBy": "div#overlay", "rect": { "x": 8, "y": 29, "width": 66.4, "height": 21 } },
    "waitedMs": 328
  }
}
```

For a missing element the code is `SELECTOR_MISSING` and `unmet` is `["attached"]`.
An option that is missing gives `unmet` `["option-present"]`; one that is
present but disabled gives `["option-enabled"]`.

Use waits instead of fixed `setTimeout` delays or "network idle". They return
as soon as the real condition holds.

---

## 8. Frame targeting (`frame`)

Run the script (and the `waitFor` checks) inside an iframe:

```json
"frame": { "selector": "iframe#payment" }        // the <iframe> element (searched in every frame)
"frame": { "name": "inner" }                     // frame name attribute
"frame": { "url": "checkout.example.com/form" }  // substring of the frame URL
"frame": { "name": "inner", "url": "/form", "timeout": 15000 }  // combine; all must match
"frame": "iframe#payment"                        // shorthand for { selector }
```

The frame is polled until it appears (`timeout` default `10000`). If it never
appears, the result is `SELECTOR_MISSING` with `details.availableFrames`.
Cross-origin iframes work.

Navigation reporting (`navigated`, `url`) always describes the **main** frame.
If the targeted iframe navigates mid-script, you get `CONTEXT_DESTROYED`.

---

## 9. Failure evidence

With `evidence: "on-failure"` (the default), a `failed` job includes:

```json
"evidence": {
  "capturedAt": "…",
  "url": "https://site/page?token=%5BREDACTED%5D",
  "consoleErrors": [ { "type": "error", "text": "pwd=[REDACTED]", "source": "https://site/app.js", "at": "…" } ],
  "failedRequests": [
    { "url": "https://site/api?api_key=%5BREDACTED%5D", "method": "GET", "resourceType": "fetch", "status": 404, "statusText": "Not Found", "at": "…" },
    { "url": "https://cdn/x.js", "method": "GET", "resourceType": "script", "errorText": "net::ERR_CONNECTION_RESET", "at": "…" }
  ],
  "screenshot": { "mimeType": "image/jpeg", "encoding": "base64", "data": "/9j/4AAQ…" },
  "html": { "content": "<!DOCTYPE html>…", "length": 48211, "truncated": false, "url": "…", "title": "…" },
  "captureErrors": { "screenshot": "…" }
}
```

- **Console errors and failed requests** cover the current document from the
  start of its load, plus anything raised during the job. At most 25 of each;
  `consoleErrorsDropped` / `failedRequestsDropped` count the rest. Requests
  blocked by the API's own ad/media blocking are not listed.
- **Screenshot**: a viewport JPEG. Sensitive inputs (card, CVV, OTP, token
  fields…) are masked for the capture and restored immediately afterwards.
  Password fields are masked by the browser anyway.
- **HTML**: from the target frame, truncated at 150 000 characters.
- `captureErrors` lists any piece that couldn't be captured. Capture is best-effort and never changes the job's outcome.
- **Not captured:** cancelled jobs, `SESSION_CLOSED`, and successes (unless `evidence: "always"`).
- Use `evidence: "never"` for high-frequency calls. Use `GET …/execute/:id?evidence=false` to poll without the large payload.

### Redaction

Nothing here ever includes cookies or request/response headers.

| Where | What is redacted |
|---|---|
| URLs (everywhere) | Query/fragment params whose names look sensitive (`password`, `pw`, `token`, `key`, `api_key`, `session`, `sid`, `csrf`, `auth`, `code`, `signature`, `card`, `cvv`, `otp`, `pin`, …), and `user:pass@` credentials. |
| Console text | `Bearer …`/`Basic …` values, JWTs, `name=value` / `name: value` pairs with sensitive names; URLs inside the text are redacted too. |
| HTML | `value` of password, hidden and sensitive-named inputs; sensitive `<textarea>` contents; CSRF/token `<meta>` content; all inline `<script>` and `<style>` bodies; `nonce` attributes. |

Redaction errs on the side of over-redacting. A field like `author` may be masked too.

---

## 10. Per-session lock

Only one state-changing command runs per session at a time. A command that
arrives while another is running is rejected **without running**:

```json
HTTP 409
{
  "success": false,
  "error_code": "SESSION_BUSY",
  "message": "Session … is already running \"execute\"; this command was not executed",
  "retryable": true,
  "activeOperation": { "operation": "execute", "jobId": "a547…", "startedAt": "…", "runningForMs": 212 }
}
```

| Locked (one at a time) | Not locked (always allowed) |
|---|---|
| `execute` (for the whole job, including a backgrounded 202 job), `goto`, `refresh`, `click`, `click-xy`, `type`, `select`, `fill`, `fill-image`, `stagehand`, `simulate-actions`, `validate-google`, `solve-recaptcha`, `configure-2captcha`, `scroll-to-bottom` | `GET /:sessionId`, `screenshot`, `html`, `content`, `check-xpath`, `validate-2captcha`, `diagnose-2captcha`, job polling, job cancel, `DELETE` (close) |

`GET /:sessionId` shows `busy` and `activeOperation`. Locks expire as a
safety net: after 10 min for route commands, and after the job's own
timeouts plus 60 s for execute. Idle-session cleanup never closes a session
in the middle of a command.

---

## 11. Long-running scripts: jobs, polling, cancel

```bash
# Start; return after at most 2 s
curl -s -X POST localhost:3000/api/session/$SID/execute -H 'Content-Type: application/json' -d '{
  "script": "for (let i = 0; i < 60; i++) { if (signal.aborted) throw signal.reason; await new Promise(r => setTimeout(r, 1000)); } return \"done\"",
  "actionId": "crawl-1",
  "timeout": 120000,
  "responseTimeout": 2000
}'
# -> HTTP 202 { "status": "running", "phase": "running", "jobId": "…", ... }

# Poll (long-poll up to 30 s; `wait` max 60000). Accepts jobId or actionId.
curl -s "localhost:3000/api/session/$SID/execute/crawl-1?wait=30000"

# Poll without evidence payload
curl -s "localhost:3000/api/session/$SID/execute/crawl-1?evidence=false"

# Cancel
curl -s -X POST localhost:3000/api/session/$SID/execute/crawl-1/cancel
# -> 200 { "status": "cancelled", "error_code": "CANCELLED", "retryable": false, ... }
# -> 409 JOB_NOT_RUNNING if it already finished (job included in "job")
```

Cancellation is **cooperative**. The job is marked cancelled at once and
`signal` is aborted. A script that ignores `signal` keeps running in the page
until it finishes or the page navigates. The session lock is released after
up to 2 s either way. A cancel during `waitFor` or frame resolution stops
before the script starts (`retryable: true`).

---

## 12. Navigation-aware scripts

Navigation detection is armed **before** the script runs. Every response says
what happened:

```json
"urlBefore": "https://site/form",
"url": "https://site/done",
"navigated": true,
"navigation": { "occurred": true, "requested": true, "committed": true, "readyState": "complete", "settled": true, "url": "https://site/done" }
```

Two typical cases:

1. **The script triggers navigation and returns** (e.g. `button.click(); return "clicked"`):
   `status: succeeded`, `navigated: true`. The response waits for the new page
   to reach `navigation.waitUntil`. Raise `navigation.graceMs` (e.g. `500`) if
   the site navigates after a delay (JS handlers, debounced submits).
2. **The navigation kills the script mid-run** (e.g. `location.href = …; await …`):
   `error_code: CONTEXT_DESTROYED`, `navigated: true`, `url` = the new page.
   The script is **not** re-run. Usually this is the expected outcome of a
   submit. Confirm from `url` or a follow-up read-only execute.

Pattern for submit steps: do the click as the last statement and `return`
immediately, then verify the landing page with a separate read-only call:

```json
{ "script": "document.querySelector('form').requestSubmit(); return 'submitted'",
  "actionId": "signup-final-submit",
  "navigation": { "graceMs": 500, "waitUntil": "load" } }
```

---

## 13. Recommended client flow

```text
POST /execute { actionId, script, args, waitFor, responseTimeout: 25000 }
 ├─ 200 succeeded       → use result; check navigated/url
 ├─ 202 running         → GET /execute/{actionId}?wait=30000 until status != running
 ├─ 409 SESSION_BUSY    → wait, then re-send (safe: it never ran)
 ├─ 422 SELECTOR_MISSING / CONDITION_NOT_MET → page not ready; inspect evidence; re-send if appropriate (safe)
 ├─ 500 CONTEXT_DESTROYED → navigation happened; read url; DO NOT re-send blindly
 ├─ 504 TIMEOUT / 500 SCRIPT_EXCEPTION → may have side effects; inspect evidence/page first
 ├─ 410 SESSION_CLOSED  → create a new session
 └─ network error / no response → re-send the SAME request (same actionId) or GET /execute/{actionId}
```

---

## 14. More examples

**Select an option once it exists:**
```json
{
  "script": "const s = document.querySelector('#country'); s.value = args.value; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === args.value",
  "args": { "value": "am" },
  "waitFor": { "selector": "#country", "option": { "value": "am" } }
}
```

**Read-back check after filling a field:**
```json
{ "script": "const el = document.querySelector(args.sel); return { value: el.value, valid: el.checkValidity() }", "args": { "sel": "#email" } }
```

**Extract Google results:**
```json
{
  "script": "return [...document.querySelectorAll('#search a h3')].map(h => ({ title: h.textContent, url: h.closest('a').href }))",
  "waitFor": { "selector": "#search a h3", "state": "attached" },
  "evidence": "never"
}
```

**Inside an iframe:**
```json
{ "script": "return document.querySelector('input[name=cardnumber]') !== null", "frame": { "url": "js.stripe.com" } }
```

---

## 15. Limits & defaults summary

| Setting | Default | Max |
|---|---|---|
| `timeout` | 60 000 ms | 600 000 ms |
| `responseTimeout` | until done | — |
| `waitFor[].timeout` / `frame.timeout` | 10 000 ms | 120 000 ms |
| `navigation.graceMs` | 100 ms | 5 000 ms |
| `navigation.timeout` | 10 000 ms | 60 000 ms |
| Poll `?wait=` | 0 | 60 000 ms |
| Job retention | 30 min, 100 per session | — |
| Closed-session memory | 1 h | — |
| Evidence lists | 25 console + 25 network entries | — |
| Evidence HTML | 150 000 chars | — |
| `actionId` length | — | 200 chars |

Code: `controllers/session/executeScript.js`, with helpers in `controllers/session/helpers/`
(`commandErrors.js`, `sessionLock.js`, `waitConditions.js`, `failureEvidence.js`, `redaction.js`).
