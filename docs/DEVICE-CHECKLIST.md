# Device testing checklist (P5, NFR-4 / NFR-13)

The automated suites cover chromium (emulated 375×667 and Pixel 7) and the
a11y/bundle/search budgets. What automation cannot tell you is how the app
feels on the hardware your family actually holds. Run this once before
tagging v1.0.0, on a real iPhone (Safari, iOS 16+) and a real Android phone
(Chrome, last 2 versions), over your home LAN.

Checklist — tick per device (🟢 iOS Safari / 🟢 Chrome Android):

1. **Install** — browser menu → "Add to Home Screen"; the app launches
   full-screen (no browser chrome) with the Kirana icon.
2. **First sync** — open the installed app, sign in; the board loads in
   about a second on Wi-Fi. Record the warm-start feel: ___s.
3. **Live sync** — two devices on the same board: add an item on A, it
   appears on B within a second.
4. **Offline** — airplane mode on B: read the board (cached), check 3
   items → the offline banner shows a queued count; airplane mode off →
   the queue drains and both devices agree. No duplicates.
5. **Add flow** — add "milk 2 l" with the thumb only; add "atta" and
   confirm the 3-tap path; add "दूध" (Devanagari) and confirm the alias
   resolves to the existing milk item.
6. **Shop Mode** — enter from the store menu; walk the aisles; the screen
   stays awake (wake lock); finish; return to Home.
7. **Keyboard** — open the add sheet and a settings sheet; the focused
   input is visible above the on-screen keyboard; Return submits.
8. **Safe areas** — nothing under the notch/home-indicator; the bottom tab
   bar clears the gesture bar.
9. **Session** — sign out; sign back in. (Session expiry after 30 days is
   server-configured; no need to wait.)
10. **Update** — after deploying a new image, reload the installed app
    twice: the new shell loads (service worker refresh).

NFR-4's real-device number: warm start (installed app, Wi-Fi) ≈ ___s on
iOS, ___s on Android (budget 1.5s; the emulated proxy measured 0.41–0.51s
at 4× CPU throttle — real devices are expected to be slower but in budget).

Record the results in `docs/progress/PHASE-5.md` (a one-line note per
device is enough). Anything that fails is a bug — file it, don't ship
around it.
