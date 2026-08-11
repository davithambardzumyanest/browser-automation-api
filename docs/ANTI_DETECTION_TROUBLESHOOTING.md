# Anti-Detection Troubleshooting Notes

A running log of concrete, confirmed causes of Google (reCAPTCHA / "unusual
traffic") flagging automated sessions from this API, and how each was fixed.
Written so a future debugging session can search by symptom instead of
re-deriving all of this from scratch.

Code referenced below lives under `controllers/session/` (`helpers/` for
shared logic, `handlers/` for the per-route handlers), which replaced the old
single-file `controllers/sessionController.js`.

---

## How to use this file

If you're seeing a captcha/block again: first figure out which bucket it
falls into, because the fix is completely different depending on which:

1. **Fingerprint/config issue** (browser reports something internally
   inconsistent or gives itself away at the JS/network level) → see
   "Fixed issues" below, and check whether a *new* change reintroduced one of
   these patterns.
2. **IP/proxy reputation issue** (the exit IP itself is already flagged,
   regardless of how clean the browser fingerprint is) → see "Proxy/network
   issues (not code bugs)".
3. **Genuinely unresolved** → see "Known open issues" at the bottom before
   spending time re-diagning from zero.

The single most useful diagnostic technique used throughout: **capture what
the destination server actually receives** (e.g. `/goto` to
`https://postman-echo.com/headers`, then read it back via `/html`) rather
than trusting the config the session was *created* with. Several of the
bugs below only showed up because the wire-level request didn't match what
the code intended to send.

---

## Fixed issues

### 1. Every tab silently lost its fingerprint spoofing after the first navigation
**Symptom:** `navigator.userAgent` and the wire-level `User-Agent` header
correctly showed the spoofed identity right after session creation, but
after calling `/goto`, both silently reverted to Chromium's raw native
identity (`HeadlessChrome/<bundled-version>`, generic `Sec-CH-UA` brands).

**Root cause (two compounding bugs):**
- Chrome always auto-creates one blank tab on launch. `createSession`
  unconditionally called `browser.newPage()`, creating a *second* tab on top
  of it. `navigateSession`'s "close every tab except index 0" logic then
  closed the properly-configured tab (index 1) and kept the raw,
  never-configured one (index 0) — every `/goto` ran on a tab that had never
  had `setupPageRealism()` applied.
- Even after fixing that, overrides applied once at session-creation time
  didn't reliably survive to whatever page object a *later* `/goto` call
  resolved via `browser.pages()[0]`.

**Fix:**
- `createSession.js` now reuses `browser.pages()[0]` instead of creating a
  new page, and closes any other pre-existing pages.
- `navigateSession.js` now calls `setupPageRealism()` again immediately
  before every navigation. `setupPageRealism()` (in `browserFingerprint.js`)
  guards the `evaluateOnNewDocument` registration with a `WeakSet` so
  repeated calls on the same page don't stack duplicate scripts.

### 2. Request interception silently dropped the spoofed User-Agent/Client-Hints
**Symptom:** Same as #1's symptom, but persisted even after fixing the tab
bug and re-applying `setupPageRealism()` right before navigating.

**Root cause:** `page.setUserAgent()`'s CDP-level override
(`Network.setUserAgentOverride`) does not reliably survive once Fetch-domain
request interception is active (needed here to block/allow images/fonts).
`request.continue()` with no explicit headers resumes the request with
Chromium's own raw headers, not the override.

**Fix:** `createSession.js`'s request handler now explicitly re-asserts
`user-agent`, `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform` on every
continued request (`identityHeaders`), in addition to (not instead of) the
CDP override and the `--user-agent=` launch flag.

### 3. UA claimed a Chrome version that didn't match the real installed binary
**Symptom:** No specific user-facing symptom observed directly, but a real
residual risk: UA/Sec-CH-UA claimed Chrome 145 (hardcoded), while the
bundled Chromium binary was actually 141. The TLS ClientHello (JA3-style
fingerprint) reflects whatever BoringSSL build really ships with the binary
and cannot be spoofed via headers - so a version mismatch here is a
wire-level-vs-TLS-level inconsistency invisible to header inspection alone.

**Fix:** `helpers/browserVersion.js` runs the actual installed binary with
`--version` once (cached), and `helpers/deviceProfiles.js` builds UA strings
from that detected version instead of a hardcoded one. Self-corrects if
`npm update puppeteer` ever bumps the bundled Chromium build.

### 4. Every session had identical hardware/WebGL regardless of platform
**Symptom:** Not a captcha trigger by itself, but a fleet-consistency
signal: every session reported `hardwareConcurrency: 8, deviceMemory: 8`
regardless of which OS the UA claimed, and WebGL vendor/renderer was
hardcoded to a single Windows/D3D11 string even for macOS/Linux UAs (a
macOS UA could report a Windows GPU backend).

**Fix:** `helpers/deviceProfiles.js` - 10 internally-consistent device
bundles (Windows/macOS/Linux), each pairing UA + WebGL vendor/renderer +
`hardwareConcurrency` + `deviceMemory` (capped at 8 - the real spec/Chrome
maximum regardless of actual RAM) + screen resolution. Screen size is also
now decoupled from viewport: never smaller than the requested viewport, but
reflects the device's real (larger) monitor resolution otherwise, instead of
always being exactly equal to the viewport.

### 5. Accept-Language header and navigator.languages independently broken and mismatched
**Symptom:** For the default locale (`en-US`), the `accept-language` header
was `"en-US,en;q=0.9,en;q=0.8"` - the same language tag twice with two
contradictory quality values - and `navigator.languages` was
`["en-US","en","en-US","en"]`, fully duplicated. Additionally, for *any*
locale, the header and `navigator.languages` never matched each other at
all (independently hardcoded templates).

**Fix:** `buildPreferredLanguages(locale)` in `browserFingerprint.js` is now
the single source of truth, used to build both the `accept-language` header
*and* `navigator.languages`, and also the `--accept-lang` launch flag (which
had the identical duplicate-`en` bug independently). See `createSession.js`.

### 6. `--start-maximized` silently overrode requested window size
**Symptom:** A non-headless session requesting a specific `width`/`height`
got a real on-screen window maximized to the host's actual screen
resolution instead - while every spoofed value (`window.outerWidth`,
`screen.*`, viewport) still claimed the originally requested size.

**Root cause:** Chrome gives `--start-maximized` priority over
`--window-size` regardless of argv order; both were being set unconditionally.

**Fix:** `createSession.js` only pushes `--start-maximized` when the caller
did *not* request an explicit width/height (nice default for interactive
use); an explicit size is honored for real. `BROWSER_ARGS` no longer
hardcodes `--window-size=1920,1080` at all.

### 7. Static headers forced on every request regardless of type
**Symptom:** (Original, earliest finding this session.) Every request -
navigation, XHR, subresource - carried identical `Sec-Fetch-Site`,
`Sec-Fetch-Mode`, `Accept`, `Upgrade-Insecure-Requests`, `Cache-Control`
values, including `Sec-Fetch-Site: same-origin` forced onto the very first
cross-site navigation (where a real browser sends `none`). A real browser
computes these per-request; a static, request-type-invariant combination is
a well-known, easily server-detectable bot signal independent of proxy/IP.

**Fix:** Stopped forcing any of these. Chrome's own network stack computes
them correctly per-request when left alone. (See `buildConsistentHeaders` in
`browserFingerprint.js` - as of the most recent pass it forces *nothing* by
default; even `accept-language` was removed once confirmed redundant, see
#10 below.)

### 8. Header casing via CDP doesn't get renormalized for HTTP/2
**Symptom:** n/a directly observed, but a real risk once any header
override is needed: `Network.setExtraHTTPHeaders` sends whatever casing you
give it, whereas real Chrome always lowercases header names on the wire for
HTTP/2 (RFC 7540 §8.1.2). A Title-Case header name is a cheap, mechanical
"not generated by Chrome's own stack" tell.

**Fix:** Any header forced via CDP uses a lowercase key.

### 9. Geolocation leaked/looked synthetic
**Symptom (two separate bugs):**
- Geolocation permission was granted to `https://*` unconditionally, even
  for sessions with no fake geolocation configured - meaning
  `navigator.geolocation.getCurrentPosition()` would silently succeed
  (no prompt) and return the browser's *real* network-derived location.
- When a caller *did* supply geolocation, its `accuracy` field sometimes
  came from a country-level IP-geolocation fallback (hundreds of km) and
  was passed straight to `page.setGeolocation()`. Real GPS/WiFi accuracy
  essentially never exceeds ~150km even in sparse rural areas - a
  463,000-meter accuracy value is not something a real browser's location
  stack would ever produce.

**Fix:** `createSession.js` only adds `'geolocation'` to the granted
permissions list when `hasFakeGeolocation` is true. `sanitizeGeolocation()`
in `browserFingerprint.js` clamps `accuracy` to 10m-150km.

### 10. Redundant/unnecessary forced headers (once launch flags were fixed)
**Symptom:** n/a (proactive cleanup, not a reported bug) - but relevant if
you're tempted to add more forced headers back.

**Finding:** Once `--lang`/`--accept-lang` launch flags were correctly
built (see #5), a page launched with *only* those flags and zero
`setExtraHTTPHeaders` calls produced the identical native
`accept-language` header. The CDP override was pure redundancy - removed.
`setupPageRealism()` now skips the `page.setExtraHTTPHeaders()` call
entirely when there's nothing to set, rather than calling it with an empty
object (an empty-object call still establishes a CDP override for zero
benefit).

**Takeaway:** the only headers forced via CDP now are `user-agent`/
`sec-ch-ua*` (see #2 - structurally unavoidable as long as request
interception is needed for image/font blocking). Everything else
(`Accept`, `Accept-Encoding`, `Sec-Fetch-*`, `Priority`,
`Upgrade-Insecure-Requests`) is 100% native Chrome generation. **Before
adding any header back, verify it's actually missing/wrong by diffing a
real browser's captured request - don't add speculatively; it was
speculative static headers that caused this whole investigation in the
first place.**

### 11. Images and fonts blocked by default, at two layers
**Symptom:** No visible error, but a structural anomaly: `allowMedia`
defaulted to `false`, blocking every `image`/`font`/`media`/`imageset`
request via `request.abort()` *and* disabling image rendering entirely via
`--blink-settings=imagesEnabled=false`. A real browser always loads these.
The destination server would see requests for HTML/CSS/JS arrive normally,
then literally zero requests ever arrive for the dozens of image/font URLs
referenced inside that HTML/CSS. Also meant all text rendered in a fallback
system font instead of the page's real web font, affecting canvas-based
text-rendering fingerprints too.

**Fix:** `allowMedia` now defaults to `true` in `createSession.js`. Callers
that specifically want the bandwidth/speed tradeoff for a non-detection-
sensitive use case can still pass `allowMedia: false`.

### 12. `toString()` cloaking gap on simple property overrides
**Symptom:** Not directly observed as a captcha trigger, but confirmed as a
real, checkable gap: `Object.getOwnPropertyDescriptor(navigator,
'webdriver').get.toString()` (and the same for `language`, `platform`,
`hardwareConcurrency`, `screen.*`, `window.*`, etc.) would have returned
real JS source instead of `function get webdriver() { [native code] }`.

**Root cause:** Earlier `toString` cloaking only wrapped *fully-replaced*
functions (`permissions.query`, `Notification.requestPermission`,
`Intl.DateTimeFormat`, WebGL `getParameter`). The much larger set of
simple `defineGetter`-based property overrides was never wrapped.

**Fix:** `defineGetter()` in `registerBrowserRealism` (browserFingerprint.js)
now cloaks its getter via the same `cloakAsNative()`/`Function.prototype
.toString` Proxy mechanism, using `get <propName>` as the native-looking
name. Verified in isolation (see git history of this file for the test).

### 13. `navigator.connection` hardcoded to an identical constant for every session
**Symptom:** Every session, regardless of real network/proxy conditions,
reported the exact same `{downlink: 10, effectiveType: '4g', rtt: 50}` - a
fleet-consistency signal (aggregated across many "different" sessions from
one operator, an identical network-conditions value is itself suspicious).

**Fix:** Removed the override entirely. Chrome's real `NetworkInformation`
API reflects actual conditions on its own; there was no benefit to forcing
a constant.

---

## Proxy/network issues (not code bugs)

These were confirmed root causes at various points in this investigation,
but no amount of browser-fingerprint code change fixes them:

- **Carrier CGNAT IP reputation.** A session's real exit IP was confirmed
  (via direct `api.ipify.org` check through the configured proxy) to be a
  T-Mobile US mobile-carrier CGNAT address, both IPv4 (`172.59.x.x`) and
  IPv6 (`2607:fb91::/32`) ranges. These pools are shared by huge numbers of
  real subscribers *and* other automation traffic simultaneously; once one
  session on a shared IP gets flagged, everyone currently mapped to it
  inherits the block regardless of fingerprint quality.

- **Reusing the same sticky proxy session ID.** The SOAX proxy credential's
  `sessionid-...` segment determines whether you get a fresh IP or the same
  sticky one. The *same* literal `sessionid` value was observed reused
  across many separate browser-api sessions/tests, meaning every retry kept
  landing back on the same (already-flagged) IP instead of a clean one.
  Rotate this value per test run, or drop the sticky segment for a rotating
  IP per connection.

- **Sessions outliving the proxy's sticky window.** SOAX credentials here
  use `sessionlength-600` (10 minutes). A session left open past that
  window can have its underlying proxy connection silently dropped
  mid-request (not a clean error - just gone), leaving the page frozen in a
  "still loading" state: blank screenshot, every JS-evaluation-based call
  (`/execute`, `/content`, `/html`) hangs completely and never returns, while
  `/screenshot` (a different, lower-level CDP domain) still responds
  instantly. **This exact symptom combination (blank screenshot + total
  hang on any JS-evaluate call + working screenshot) is diagnostic for a
  stuck/dead network connection, not an active captcha you can see.** If you
  hit this, check session age against the proxy's sticky window before
  assuming it's a fingerprint issue.

---

## Known open issues (not yet root-caused)

- **Recurring stuck-navigation hangs even within the proxy's sticky
  window.** The symptom in the last bullet above was also observed on a
  session well within its 10-minute sticky window, so proxy-window expiry
  isn't the only cause of it. Not yet diagnosed further - if it recurs,
  capture a screenshot + try `/execute` immediately (don't assume it's a
  captcha; confirm hung-vs-blocked first using the technique above).

- **Enter-press not triggering search navigation in one observed case.**
  A session showed Google's homepage with the query correctly typed and the
  autocomplete suggestions dropdown open and populated (proving the session
  was *not* blocked/flagged - suggestions come from a live XHR to Google),
  but pressing Enter via `/fill` (`pressEnter: true`) never navigated to
  search results, and the session became unresponsive shortly after. Not
  yet reproduced/isolated from the proxy-hang issue above - could be the
  same root cause, could be separate. Worth testing with `allowMedia: true`
  now active (previously all tests of this had it off) in case slower page
  settling changed timing assumptions around the Enter keypress.

- **`navigator.plugins` composition not verified either way.** It shows
  `["PDF Viewer","Chrome PDF Viewer","Chromium PDF Viewer","Microsoft Edge
  PDF Viewer","WebKit built-in PDF"]` (from `puppeteer-extra-plugin-stealth`'s
  own plugin-spoofing evasion, not this codebase's). Flagged as possibly
  implausible (Edge/WebKit-branded entries appearing in a Chrome session),
  but **not fixed** - genuinely uncertain whether this is a stealth-plugin
  artifact or real Chromium behavior (built-in PDF viewers do register
  under multiple legacy-compatibility aliases across Chromium-based
  browsers). Don't "fix" this without independently confirming which it is
  first - replacing a possibly-correct value with an unverified hand-picked
  list could make it worse.

- **`/stagehand` (AI-driven actions) is currently non-functional.**
  `runStagehandSession.js` unconditionally returns `501`, left over from
  when Stagehand initialization was removed from `createSession.js` (its
  init script set literal global markers `window.__stagehandV3__` /
  `window.__stagehandV3Injected` and monkey-patched
  `Element.prototype.attachShadow` with zero `toString` cloaking - a
  trivially fingerprintable signature applied to every session whether or
  not the AI endpoint was ever used). Stagehand initialization was
  subsequently restored in `createSession.js`, but the 501 in
  `runStagehandSession.js` was never reverted to match. If you need
  `/stagehand` working again, either wire the endpoint back up to use
  `session.stagehand`/`session.agent`, or make Stagehand initialization
  lazy (only on first `/stagehand` call for a session) to get the
  functionality back without paying the fingerprint cost on sessions that
  never use it.
