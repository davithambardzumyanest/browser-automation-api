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

### 14. `/stagehand` (AI-driven actions) unconditionally returned 501 after the session-routes refactor
**Symptom:** Every call to `POST /:sessionId/stagehand` returned
`501 Stagehand unavailable`, even though `createSession.js` was actively
constructing a `Stagehand` instance (`session.stagehand`) and an agent
(`session.agent = stagehand.agent()`) for every session.

**Root cause:** `runStagehandSession.js` had an unconditional `501` stub
left over from an earlier point in this project's history where Stagehand
initialization was deliberately removed from `createSession.js` (its init
script left fingerprintable global markers on every page - see the old
`Fix Stagehand` history). Stagehand init was later restored in
`createSession.js`, but during the session-controller split
(`sessionController.js` → `controllers/session/`) the stub got carried over
into the new `runStagehandSession.js` handler verbatim instead of being
reconciled with `createSession.js`'s actual (restored) behavior - the two
files silently drifted out of sync.

**Fix:** Rewrote `runStagehandSession.js` to use the session's existing
`session.stagehand` / `session.agent` (already created once, at session
creation time, in `createSession.js`) instead of constructing a new
Stagehand instance per call. Mode branching restored: `act`/`observe` call
`stagehand.act()`/`stagehand.observe()` directly; `agent` mode calls
`session.agent.execute({instruction, messages: session.agentMessages})`,
persisting `result.messages` back onto the session so consecutive
`/stagehand` calls in `agent` mode continue the same CUA conversation
instead of each one re-orienting from scratch. All three modes race against
`timeoutMs`. Verified live end-to-end against `https://example.com`: `observe`
correctly located the "Learn more" link's selector, and `agent` mode clicked
it and confirmed navigation to `iana.org/help/example-domains`.

**Open tradeoff (unresolved):** Stagehand is still initialized eagerly for
*every* session in `createSession.js`, regardless of whether `/stagehand` is
ever called - paying whatever fingerprint cost its injected scripts carry
even on sessions that only use `/goto`, `/fill`, `/click`, etc. Making this
lazy (init on first `/stagehand` call) would avoid that cost for the common
case but wasn't part of this fix - flagging in case detection issues return
and this is worth revisiting.

---

### 15. Navigation to resource-heavy real pages (Google search/homepage) hung forever, while simple pages and in-page fetch() were unaffected
**Symptom:** `/goto` to `google.com` or `google.com/search` reliably hit the
90s navigation timeout - screenshot during the hang showed a blank white
page (no captcha, no block page, nothing rendered), and *every* subsequent
call on that session (including unrelated `/execute` calls, and even a
`window.location.href =` navigation triggered directly from in-page JS,
bypassing Puppeteer's navigation entirely) hung too, as if the page's JS
execution context had wedged. `Page.captureScreenshot` kept responding
instantly throughout (a different CDP domain, not gated on whatever was
stuck). This reproduced with proxy and without, headless and headful, with
or without a 10-minute `simulate-actions` warm-up first, and regardless of
Stagehand being initialized - none of those were the cause. Simple pages
(`example.com`, a local `file://` page, even `http://127.0.0.1`) always
navigated fine on a fresh session.

**Decisive control (see "How to use this file" above):** an in-page
`fetch()` to the exact same `google.com/search?...` URL, run via `/execute`
on an already-loaded page, resolved in ~190ms. That's the same technique
documented for telling a real block from a broken navigation path - it
proved the network/TLS/proxy/fingerprint path was completely clean and put
the bug squarely in this codebase's navigation handling, not in anything
Google was doing.

**Root cause:** `createSession.js`'s request-interception handler (added
for #2 above, to keep the spoofed User-Agent/Sec-CH-UA on the wire once
Fetch-domain interception is active) called
`request.continue({ headers: {...} })` - i.e. passed an explicit headers
object - on *every single intercepted request*, not just the top-level
document request. `request.continue()` with no headers argument is a fast
native-path resume; passing explicit headers forces Chrome to reconstruct
the request. That's fine for a page with one or two requests (which is why
`example.com`/local files/a bare `fetch()` never showed the bug), but with
the dozens of concurrent subresource requests a real page like
`google.com/search` fires at once, it reliably deadlocked Chrome's
Fetch-domain handling entirely - hanging the request that never got
continued, and by extension the page's whole lifecycle and JS execution.
Confirmed by bisecting with env-gated debug flags: interception off →
works; interception on with headers stripped from every `continue()` call →
works; interception on with the original per-request headers override →
hangs every time on Google, never on simple pages.

**Fix:** Scope the explicit header override to `request.resourceType() ===
'document'` only (the one request whose wire-level identity actually
mattered for #2's original bug); every other resource type now gets a
plain `request.continue()`. Verified: wire-level `user-agent`/`sec-ch-ua*`
on the document request still come through correctly spoofed (checked via
`postman-echo.com/headers`), and `google.com/search` now loads real results
in 1-3s consistently, with Stagehand initialized and interception fully
enabled - i.e. the normal, unmodified production configuration.

**Takeaway:** when a hang is Google-specific-looking but the in-page
`fetch()` control comes back clean, don't assume it's this codebase's
*fingerprint/header content* - check whether it's a *mechanism* bug that
only manifests under the request volume/concurrency a real heavy page
generates, since that's invisible on any single-request test.

**Addendum - authenticated proxy makes the same class of hang reappear:**
after the fix above, a session with no `proxy` still hung on
`google.com/search` the first time it was retried through an authenticated
SOAX proxy (`page.authenticate()` from `proxyAuth.js`, needed because
Chrome's `--proxy-server` flag carries no credentials). Isolated by
disabling this codebase's own interception entirely (temporary debug flag)
with the proxy still active: the hang persisted, proving it's not our
`page.on('request')` handler this time - `page.authenticate()`'s own
internal CDP Fetch-domain auth-challenge handling has the same class of
problem, independent of anything in this codebase. `example.com` (few
requests) through the same proxy loaded fine every time; only a
high-concurrency page's *first* burst of simultaneous proxy-auth challenges
(before Chrome's network service has cached a successful auth) triggers it.

**Working mitigation (confirmed 2026-08-24):** `/goto` the target site's
homepage first (a lower-concurrency page - lets the proxy connection get
its first auth challenge answered without contention), then run
`POST /:sessionId/simulate-actions` for several minutes before the real
`/goto` to a heavy page. Verified end-to-end: session with proxy → goto
`google.com` → `simulate-actions` for 10 minutes → goto
`google.com/search?...` → real results in 1.5s, rich SERP (local map pack,
organic results), no captcha. This is a mitigation, not a proper fix - it
avoids the request-concurrency burst rather than fixing whatever in
`page.authenticate()`/puppeteer-core's Fetch-domain handling can't cope
with it. A more durable fix if this becomes a recurring pain point: stop
using `page.authenticate()` for the upstream proxy entirely by running a
local unauthenticated forwarding proxy (e.g. the `proxy-chain` npm
package) that injects `Proxy-Authorization` to the real upstream proxy
itself, and point `--proxy-server` at that local address - Chrome then
never needs CDP-level auth-challenge handling at all.

**Update 2026-08-24 - implemented, and it does NOT fix the hang.**
`proxy-chain` is now wired in (`createSession.js` + `closeSession.js`,
`buildAuthenticatedProxyUrl()` in `proxyAuth.js`) and is a real improvement
- credentials never touch CDP, `page.authenticate()` is skipped entirely
for anonymized-proxy sessions - but a fresh session, proxy-chain active,
going *directly* to `google.com/search` with no warm-up **still hangs the
same way**. That disproves the theory that CDP's auth-challenge handling
was the (sole) bottleneck. Bisected further, on a freshly-cleaned host
(see the resource-leak note below - don't trust results from a host with
leftover Chrome trees eating RAM):

- The upstream SOAX proxy itself is not the bottleneck: 30 concurrent
  `curl` requests through it (same proxy, same credentials) all completed
  in under 3 seconds total.
- `curl` through the same proxy with a full browser-like header set
  (real UA, `sec-ch-ua*`, `Sec-Fetch-*`, `Accept-Language`) straight to
  `google.com/search` also succeeded instantly (1.8s, real 92KB body) -
  ruling out Google-side IP-reputation/header-based stalling for this
  proxy IP.
- Reducing Chrome's own concurrent request count (`allowMedia:false`,
  blocking images/fonts) did **not** avoid the hang either.
- A single successful low-concurrency navigation through the proxy right
  before the real one (`example.com` then immediately `google.com/search`)
  did **not** "warm" anything enough to avoid it.
- A completely fresh SOAX `sessionid` (never used before, verified via
  `api.ipify.org` to be a different exit IP than any prior test today)
  going in cold still hung identically. Rules out "this specific IP got
  reputation-flagged from today's heavy reuse" as the cause of *the hang*
  - though see the separate 429 finding just below, which IS a real,
  distinct reputation effect from that reuse.
- The failure is proxy-presence-specific, not proxy-chain-specific:
  plain desktop Chrome + `--proxy-server` pointed at the *same* SOAX proxy
  (no mobile emulation, no custom headers, this fix's document-only
  header override from #15 in place) hangs on `google.com/search` the
  same way with no warm-up.

Net: this points to something in **Chrome's own networking stack**
specifically when `--proxy-server` is set and a page opens many
concurrent HTTPS connections at once - not this codebase's request
interception (already isolated out in #15), not CDP auth-challenge
handling (isolated out by the proxy-chain test above), not the proxy
itself, and not Google reacting to anything about the request. Not
root-caused further - moved to "Known open issues" below.

**Working mitigation, still the best one found:** goto a low-concurrency
page first (e.g. the target site's homepage), then run
`POST /:sessionId/simulate-actions` for several minutes before the real
navigation to a heavy page. **This is NOT reliable, not a fix** - repeat
testing on 2026-08-24 got roughly a 50% success rate with the full 10-
minute warm-up (one clean success with a rich real SERP, one hang with
an otherwise-identical run), versus 0/4 successes going in cold (no
warm-up at all) across both mobile and desktop profiles. Use it because
it's better than nothing, not because it's dependable - don't promise a
caller it will always work.

---

### 16. `isMobile`/`hasTouch` were accepted by `/session/create` but silently discarded - no session was ever actually mobile-emulated
**Symptom:** A session created with a mobile UA (iPhone/Android) plus
`isMobile: true, hasTouch: true` in the request body looked mobile from
the outside (`config.width`/`height` echoed back correctly, UA was the
requested mobile string) but was internally inconsistent: real device
signals never matched. `navigator.maxTouchPoints` was always `0`,
`'ontouchstart' in window` was `false`, CSS `(pointer: coarse)`/
`(hover: none)` never matched, and Chrome's own mobile viewport behavior
(layout viewport quirks, `(pointer: coarse)`-gated CSS on real sites)
never activated - a real touchscreen phone reporting zero touch capability
at every layer simultaneously.

**Root cause:** `isMobile`/`hasTouch` were never destructured from the
request body in `createSession.js` at all, and were hardcoded `false` in
**three separate places**: `launchOptions.defaultViewport` (the very first
viewport Chrome launches with), `viewportSettings` (rebuilt right after and
assigned back over the first one), and `setupPageRealism()`'s
`page.setViewport()` call in `browserFingerprint.js` - which runs again
before *every* navigation (see the note above it), so even a caller that
patched around the first two hardcodes would still get silently reverted
to desktop on the first `/goto`. `buildBrowserProfile()`'s
`hardware.maxTouchPoints` was independently hardcoded to `0` regardless of
`hasTouch`, feeding the `navigator.maxTouchPoints` spoofing getter in
`registerBrowserRealism()`.

**Fix:** `isMobile = false, hasTouch = false` are now destructured params
on `/session/create` (documented in the response `config`), threaded
through `buildBrowserProfile()` into `browserProfile.viewport`, and read
from there (instead of hardcoded) by all three of the places above.
`hardware.maxTouchPoints` is now `hasTouch ? 5 : 0` (5 matches real iOS/
Android devices). Verified end-to-end on a live `google.com` page, not
just `about:blank`: `maxTouchPoints:5`, `ontouchstart` present, `(pointer:
coarse)`/`(hover: none)` both matching, correct 414x896 viewport - and
confirmed this survives a `/goto` (previously the exact call that reverted
it).

**Unrelated to this fix, but found on the same request payload:** a
caller-supplied `headers` object that force-sets `sec-ch-ua`/
`sec-ch-ua-mobile`/`sec-ch-ua-platform` while spoofing a Safari UA is a
self-inflicted inconsistency, not something this codebase should paper
over speculatively (see #10's takeaway) - real Safari never sends Client
Hints headers at all, at any version. Confirmed: with no custom headers,
`applyChromeIdentity()`'s `page.setUserAgent(nonChromeUA)` (no
`userAgentMetadata` argument) already makes Chrome suppress `sec-ch-ua*`
entirely on the wire - verified via `postman-echo.com/headers`. Don't add
those headers back for a non-Chrome UA; the native behavior is already
correct. Similarly, a caller-forced `Cache-Control` header on every
request (not just the document) can break the *target site's own*
same-origin subresource loading via CORS preflight rejection (observed:
Google's own font/XHR calls failing with "Request header field
cache-control is not allowed by Access-Control-Allow-Headers") - another
argument for not forcing static headers per #7/#10.

**Testing gotcha worth recording:** killing this server with `pkill -9`
during iterative debugging orphans the Chrome process tree it launched
(Chrome isn't a child that dies with its Node parent on SIGKILL). Repeated
restarts during one debugging session leaked ~130 Chrome processes / 16GB
RSS on this 15GB-RAM host before it was noticed, and briefly produced a
session crash ("No pages available after closing tabs" after a
`simulate-actions` run) that looked profile-specific but was actually
plain OOM pressure. Always `pkill -f "var/www/aaron/browser-api"` (matches
every Chrome subprocess's `--user-data-dir`, not just the Node process)
after a hard restart, and check `free -h` before trusting a hang/crash
result as meaningful.

---

### 17. The proxy+concurrency navigation hang (entry #15's addendum) is specific to this project's bundled Chromium 141.0.7390.78 - confirmed fixable by using a different Chrome build
**Root-caused 2026-08-24**, closing out the "Known open issues" entry that
previously lived here. Tested the exact same repro (proxy configured, no
warm-up, straight to `google.com/search`) against three different Chrome
binaries via `PUPPETEER_EXECUTABLE_PATH`:

- `linux-141.0.7390.78` (this project's Puppeteer-managed download): hangs
  every time, as documented in #15.
- The host's real installed Google Chrome, `145.0.7632.116`: **never
  hangs** - consistently fast (1-3s), correct response every time (though
  see the caveat below about which Chrome install to use for this).
- A fresh, dedicated `152.0.7977.54` downloaded via
  `npx puppeteer browsers install chrome@stable` specifically for this
  test (not the host's personal install): **also never hangs** - same
  fast, consistent behavior.

So this was never a proxy, CDP, or request-interception bug at all - it's
a bug/quirk specific to the exact Chromium 141.0.7390.78 build Puppeteer
happens to have cached on this host. **Fix: don't use the host's personal
Chrome install for automation** (a captcha-consistency concern, not the
hang - see the new proxy/network bullet below) - instead pin
`PUPPETEER_EXECUTABLE_PATH` (or update the Puppeteer-managed download) to
any Chrome build newer than 141. `npx puppeteer browsers install
chrome@stable` in this project's directory downloads a fresh, dedicated
build under `~/.cache/puppeteer/chrome/` with no ties to any personal
browser profile.

**A `google.com/sorry/index` captcha still shows up after this fix - but
that's expected, and this project already has the tool to handle it.**
Even on both non-hanging Chrome builds, with a `simulate-actions` warm-up
and a completely fresh never-used proxy IP, the search navigation landed
on the captcha page essentially every time - reproduced identically
across three Chrome versions, `stealth: true` (the default), a browser-
level fingerprint already confirmed clean (`navigator.webdriver:false`,
consistent UA/Client-Hints/TLS-version pairing), and even on a `curl`-
verified never-flagged IP. Meanwhile plain `curl` with matching headers
against the exact same IPs *never* got this page, on any IP fresh or
heavily reused. That combination points at Google detecting the
CDP-driven browser itself on its most heavily-hardened endpoint (search),
not the network/IP layer or anything spoofable via headers/JS overrides -
a hard limit of CDP-based automation there, not a bug in this codebase.

**This is a solved problem for this project, just not by avoiding the
challenge - by solving it.** `POST /:sessionId/solve-recaptcha` (see
`solveRecaptchaEndpoint.js` / `helpers/recaptcha.js`) already detects the
Enterprise reCAPTCHA v2 on this exact `/sorry/index` page, solves it via
the configured 2Captcha key, injects the token, and (with
`submitAfter: true`) clicks through - verified end-to-end 2026-08-24 on a
mobile session: real solve took ~60-90s, then a full, real, rich SERP
(local map pack, business listings, images, Reddit/Yelp results) loaded
correctly. Treat hitting this page as an expected step in the flow, not a
failure: `/goto` the search URL, check the resulting `url` for
`/sorry/index`, and if present call `/solve-recaptcha` with
`submitAfter: true` before reading `/content`.

---

### 18. Two real, independently-verified fingerprint bugs found via bot.sannysoft.com - fixed, but did NOT eliminate the Google Search captcha from #17
**Found and fixed 2026-08-24** while chasing whether entry #17's captcha
could be avoided rather than solved. Ran a live session against
`bot.sannysoft.com` (the public Intoli.com-derived headless-detection test
page) instead of guessing at fingerprint gaps - it flagged two concrete,
independently-verifiable failures:

**a) `navigator.webdriver` override was self-defeating.** Modern Chrome
(88+) already reports `navigator.webdriver === false` natively once
`--disable-blink-features=AutomationControlled` is set (already the case
here), and `puppeteer-extra-plugin-stealth`'s own dedicated
`navigator.webdriver` evasion (already active by default via `stealth:
true`) explicitly no-ops for exactly that reason - its source comment
says so. This codebase's `registerBrowserRealism()` added its own
`defineGetter(navigator, 'webdriver', () => false)` on top of that
anyway. Same value, wrong mechanism: `Object.defineProperty` on the
`navigator` *instance* creates an *own property*, whereas native Chrome
only ever has `webdriver` on `Navigator.prototype`. sannysoft's
"WebDriver (New)" check specifically looks for exactly that own-property
presence - failed with the override in place, passed with it removed.
**Fix:** deleted the override entirely; let Chrome + stealth handle it,
which they already did correctly.

**b) `navigator.permissions.query({name:'notifications'})` returned an
impossible value.** `PermissionStatus.state` can only ever be `'granted'`,
`'denied'`, or `'prompt'` - never `'default'` (that's a
`Notification.permission`-only value, a different, unrelated enum). This
codebase's permissions profile used `notifications: 'default'` for both
`Notification.requestPermission()` (correct - that one really does use
'default') *and* fed the same literal string into `permissions.query()`'s
`state` field (wrong - no real browser can produce that value there).
sannysoft's "Permissions (New)" check flagged this directly. **Fix:**
`toPermissionState()` maps `'default'` → `'prompt'` specifically for the
`query()` path, leaving `requestPermission()` untouched.

**Related, found investigating (b) further: `--disable-notifications`
removes `window.Notification` entirely.** Not just auto-denying
prompts - with this launch flag present, `typeof Notification ===
'undefined'` on every page, confirmed live, on a host with a real,
running desktop notification service (`org.freedesktop.Notifications`
registered on D-Bus) Chrome would otherwise have used. A real user's
Chrome always has `window.Notification` defined, permission state
notwithstanding. **Fix:** removed `--disable-notifications` from
`BROWSER_ARGS` - permission behavior was already fully controlled at the
JS layer (the `query()`/`requestPermission()` patches above, plus
stealth's own `Notification.permission` evasion), so the blunt launch
flag was both redundant and the actual source of the gap.

**Verified all three independently via `bot.sannysoft.com`:** both red
("failed") rows went green before vs. after, on the same session, no
other changes. **However: re-ran the exact #17 repro (fresh IP, mobile,
headful, `Chrome/152.0.7977.54`, direct to
`google.com/search?q=...`) immediately after, and it still landed on
`/sorry/index`.** These were real, worth-fixing bugs - and worth keeping
fixed regardless - but they were not what's driving the Google Search
captcha in entry #17. Whatever Google is keying on there sits deeper than
individual JS-readable properties (this is now the third and fourth
distinct fingerprint gap ruled out for that captcha, on top of proxy/IP/
timing already ruled out in #17's own investigation). Solving via
2Captcha (#17) remains the only working answer for search specifically -
don't reopen this angle without new evidence pointing at a specific
signal.

---

### 19. The Google Search captcha is (mostly) the proxy exit IP, not the browser - preflight the IP before spending a session on it
**Root-caused 2026-08-24**, and it invalidates the working theory in #17/#18
that this was primarily CDP/browser detection.

**The control that settled it:** run `curl` and the browser against the
*same* proxy `sessionid` (so the same sticky exit IP), back to back. Earlier
curl checks looked clean only because they happened to land on different,
unflagged IPs - never the same one the browser was using. Once pinned to one
IP:

- A large minority of this pool's exit IPs answer `/search` with
  `302 -> /sorry/index` **for plain `curl`**, no browser involved. Sampled
  10 fresh SOAX US sessionids on 2026-08-24: **2/10 flagged for curl alone.**
  A browser session created on one of those is guaranteed to hit the captcha
  regardless of fingerprint - and you've already paid for a Chrome launch by
  the time you find out.
- Sticky sessions really are sticky: the browser and a `curl` probe using the
  same credential were confirmed to share one exit IP (`172.59.161.2` for
  both), so a preflight probe genuinely tests the IP the session will use.

**So the practical fix is to stop spending browser sessions on already-burned
IPs.** `utils/pickCleanProxySession.js` (added here) does exactly that:
`isProxyCleanForGoogle(proxy, {userAgent})` issues one no-redirect GET to
`/search` through the proxy and treats a 3xx-to-`/sorry/` as flagged;
`pickCleanProxySession(makeProxy, {attempts, userAgent})` rotates the
caller's sessionid key until a clean exit IP turns up and returns the proxy
config to create the session with. It takes the caller's own `makeProxy`
callback rather than assuming any credential format, so no proxy
credentials live in the project (see the standing rule about that). Costs
~1s and no browser per check.

**Measured reality - preflighting is NOT a fix on its own.** A curl-clean IP
turned out to be a weak predictor of browser success. Measured over 6
consecutive runs, each on a freshly-rotated, curl-verified-clean exit IP,
mobile Android-Chrome UA, current Chrome build: **0/6 avoided the captcha.**
Across the whole day's testing exactly one browser run ever returned a real
SERP on a preflighted IP (a full Jacksonville mobile SERP - map pack,
Reddit/Yelp results, verified by screenshot), i.e. roughly **1 in 8** - that
success was luck, not the preflight working. Confirmed on one clean IP that
`curl` returned 200 for the same query both *before and after* the browser
was served `/sorry/index` on that very IP, so Chrome plainly faces scrutiny
`curl` does not, on IPs that are not otherwise burned.

**What this means practically:** preflighting only removes the ~20% of IPs
that are *guaranteed* to fail; it does not make the remainder reliable.
Do not build a flow that assumes a clean IP means a clean search.
**`/solve-recaptcha` (#17) remains the only reliable path for Google Search
through this proxy pool** - it is a required step, not a fallback. Use the
preflight to avoid wasting browser launches and captcha-solve credits on
already-burned IPs, and expect to solve a captcha on most runs regardless.

**Do not re-chase fingerprint theories for this without new evidence.**
Between #17, #18 and this entry the following are all ruled out as *the*
cause: the bundled-Chromium hang (real, separate, fixed), `navigator.
webdriver`/permissions/`Notification` gaps (real, separate, fixed, verified
green on bot.sannysoft.com), request-interception header rewriting and
HTTP/2 header order (tested with interception fully disabled - captcha
unchanged), UA/TLS mismatch (tested with an Android *Chrome* UA so the UA
matches Chrome's actual TLS stack - captcha unchanged), warm-up/timing, and
sticky-IP reuse.

---

### 20. Mobile sessions had a desktop identity end to end - Android/iOS UAs fell through to the desktop platform branch
**Found and fixed 2026-08-24.** `detectPlatformFromUA()` only ever matched
Windows/macOS/Linux. An Android UA string contains the literal `Linux`
(`Mozilla/5.0 (Linux; Android 14; Pixel 8) ...`) and an iOS one contains
`Mac OS X` (`... (iPhone; CPU iPhone OS 16_3 like Mac OS X) ...`), so every
mobile session matched a *desktop* branch and inherited a desktop identity,
while simultaneously emulating a 412x915 touchscreen at DPR 2.625 and sending
a `Mobile Safari` UA. Verified live on the wire (postman-echo) and in-page,
on a session created exactly the way the failing Google runs created theirs:

| signal | was | real Android Chrome |
|---|---|---|
| `sec-ch-ua-mobile` (wire) | `?0` | `?1` |
| `sec-ch-ua-platform` (wire) | `"Linux"` | `"Android"` |
| `navigator.userAgentData.mobile` | `false` | `true` |
| `navigator.userAgentData.platform` | `"Linux"` | `"Android"` |
| `navigator.platform` | `Linux x86_64` | `Linux armv8l` |
| WebGL renderer | `ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 ...)` | ANGLE over OpenGL ES (Mali/Adreno) |

i.e. a phone advertising a discrete desktop Intel GPU and telling every
server it was a desktop, on the same request whose UA said `Mobile`. Three
separate places each hardcoded the desktop value independently, which is why
they could disagree with each other and with the UA: `identityHeaders` in
`createSession.js` (`'sec-ch-ua-mobile' = '?0'`), `buildChromeClientHints()`
(`mobile: false, architecture: 'x86', bitness: '64'`), and
`registerBrowserRealism()`'s `navigator.userAgentData` override (same three
again). **Fix:** `detectPlatformFromUA()` matches Android/iOS *before* the
desktop branches and returns `mobile`/`model` alongside the platform;
everything downstream derives from that one value, so the header, the
metadata Chrome is given, and the JS-visible object cannot diverge. Real
Chrome on Android reports `architecture: ""`/`bitness: ""` (it declines to
report them at all on mobile) and fills in `model`, so those follow the same
switch. Added Android/iOS WebGL profiles, plus a per-model override keeping
Pixel/Tensor devices on ARM Mali rather than the Adreno default.

Also fixed here: a mobile profile claimed `window.outerHeight = viewport +
88` (the desktop tab-strip/omnibox allowance), i.e. **a browser window 88px
taller than the entire screen** on a 412x915 phone, and deducted a 40px
desktop taskbar from `screen.availHeight` that phones do not have.

**This did not remove the Google Search captcha** - see #21 for why no
fingerprint fix could have, on the IP these were tested from. They are real
bugs worth keeping fixed regardless: any one of them is a single-expression
check.

---

### 21. Every JS override was an OWN property on `navigator`/`screen` - entry #18 fixed exactly one instance of this and missed the other eighteen
**Found and fixed 2026-08-24.** Entry #18 correctly established that
`Object.defineProperty(navigator, 'webdriver', ...)` is self-defeating
because it creates an *own property* on the `navigator` instance, whereas
the real attribute lives on `Navigator.prototype` - and removed that one
override. But `registerBrowserRealism()`'s own `defineGetter()` helper
targeted the instance for **every** property it spoofed, so the exact same
tell remained on twelve navigator properties and six screen properties:

```js
Object.getOwnPropertyNames(navigator)
// was: ["language","languages","platform","vendor","productSub",
//       "cookieEnabled","pdfViewerEnabled","doNotTrack",
//       "hardwareConcurrency","deviceMemory","maxTouchPoints","userAgentData"]
Object.getOwnPropertyNames(screen)
// was: ["width","height","availWidth","availHeight","colorDepth","pixelDepth"]
```

**Baseline, measured directly against this project's own Chrome binary with
no patches applied: both are `[]`.** So the override list didn't just reveal
that the session was patched - it enumerated, by name and in order, exactly
which values were being faked. One expression, no network, no heuristics.
`navigator.permissions.query` had the same shape (assigning to the instance
rather than patching `Permissions.prototype`).

Two smaller mismatches fixed alongside it: the spoofed descriptors were
`enumerable: false` where the real WebIDL attributes are `enumerable: true`,
and the `window` overrides dropped the real setters (`window.innerWidth` has
both a getter and a setter in real Chrome). `redefineAccessor()` now reuses
the original descriptor's `set` and `enumerable`, and `defineGetter()`
routes `navigator`/`screen` to their interface prototypes - `window` stays
in place, because its properties legitimately ARE own properties of the
global object (confirmed against the same unpatched baseline).

**Verified:** `Object.getOwnPropertyNames(navigator)` and `...(screen)` both
return `[]` on a patched session now, with all spoofed values still applied.

**And it still did not fix the Google Search captcha - because on the IP it
was tested from, nothing could have.** The control that settles it, run on
this host with no proxy:

- `curl` to `/search` -> **HTTP 200**, no redirect. The IP is not hard-blocked.
- In-page `fetch()` to the same URL from inside a flagged session -> **200, a
  real 92KB SERP**. Same browser, same cookies, same TLS, same IP.
- A top-level **navigation** to that same URL -> `/sorry/index`, every time.
- **Vanilla `puppeteer.launch()`** - no stealth, no realism patches, no proxy,
  default HeadlessChrome UA, with real `NID`/`AEC` cookies from the homepage
  -> **also `/sorry/index`.**
- The **committed HEAD version** of this codebase, stashing all uncommitted
  work -> **also `/sorry/index`**, on the same query pattern.

So on this host's IP, Google currently answers *every browser navigation* to
`/search` with the captcha and every non-browser request with 200, regardless
of fingerprint quality or codebase version. **A fingerprint A/B test run here
cannot produce a signal** - the outcome is pinned to failure before the
browser is configured. Any future "does this fix the captcha" test MUST be run
somewhere the control passes first: confirm vanilla `puppeteer.launch()` gets
a real SERP on that IP, and only then compare configurations. Do not read a
`/sorry` on this host as evidence about a fingerprint change - it says nothing.

(Note also: this host's own exit IP geolocates to Armenia - Google serves it
`<html lang="hy">` - while sessions default to `en-US`/`America/New_York`.
Unrelated to the captcha, but it makes this host a poor stand-in for the US
proxy exits the project actually targets.)


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

  **Reproduced concretely 2026-08-24:** after the same literal `sessionid`
  had been reused for dozens of Google navigations over ~3 hours during
  the proxy+concurrency-hang investigation (entry #15's addendum), a real
  user test on that same credential got an actual response from Google
  instead of a hang - `google.com/sorry/index`, HTTP 429 ("unusual
  traffic"), for a live search query. That's a distinct symptom from the
  hang (Google responded; it just didn't like the request) and confirms
  this bullet isn't theoretical. Rotating to a never-used `sessionid`
  (verified via `api.ipify.org` to be a genuinely different exit IP) did
  **not** fix the separate concurrency hang - the two issues are
  independent and can both be in play at once. Generating a new
  `sessionid` needs no SOAX dashboard access: it's a free-form client-
  chosen string embedded in the proxy username, not an account-issued
  token - any new random string rotates to a different sticky IP.

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

