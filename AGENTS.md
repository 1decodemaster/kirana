# AGENTS.md

**Project:** Kirana — self-hosted household shopping board  
**Applies to:** every agent and human contributor, in every session, without exception.  
**Companion:** `docs/PRD.md` (the specification). If this file and the PRD conflict on _what_ to build, the PRD wins. If they conflict on _how to behave_, this file wins.

* * *

## 1. Prime directive

**Ship a small, correct, boring app that a non-technical family member can use with one thumb, and never lose their data.**
Every judgement call resolves in this order:

1.  Does it protect user data?
    
2.  Does it make the common action faster or clearer?
    
3.  Does it keep the codebase small enough for the next agent to understand?
    
4.  Does it satisfy the PRD?
    

Anything not serving those four is scope creep.

* * *

## 2. Read before you write

At the start of every session, read **exactly these four things, in this order**:

1.  `AGENTS.md` (this file)
    
2.  `docs/STATUS.md` — ≤60 lines, current state
    
3.  `docs/progress/PHASE-<current>.md` — the running log
    
4.  Any `docs/DECISIONS/ADR-*.md` created since your last session
    

Then open **only** the files you intend to change or test.
**Forbidden:** "Let me read the whole repo to understand the project." It burns context, invites drift, and produces edits outside your lane. If you don't know where something lives, use `grep -r` or `git log --oneline -- <path>`.

* * *

## 3. Phase discipline

1.  **Work on exactly one phase at a time.** The current phase is whatever `STATUS.md` says. Do not start the next one, even if you have spare capacity.
    
2.  **Do not implement ahead.** If a later phase's requirement is obvious while you're working, write it in `docs/BACKLOG.md`. Do not code it.
    
3.  **Do not reach back.** If an earlier phase shipped something imperfect, file it in `docs/BACKLOG.md` unless it blocks your gate. Refactoring a closed phase without an ADR is drift.
    
4.  **A phase ends only at its gate.** Passing tests is not the gate; the gate checklist in PRD §16 is.
    
5.  **Never leave a phase half-applied.** If you must stop mid-task, leave the branch pushed, `STATUS.md` updated, and a handoff note written.
    

* * *

## 4. Scope & contract rules

1.  `shared/**` **is contract territory.** Any change there requires a PR prefixed `contract:` and an ADR. It must merge before any dependent work continues.
    
2.  **No new dependency** without a one-line justification in the phase log and, for anything non-obvious, an ADR.
    
3.  **No schema change after P0** without an ADR. Migrations are serialized: claim the next number in `STATUS.md` before writing the file.
    
4.  **No deviation from the PRD.** If the PRD is wrong, write an ADR explaining why, get it accepted, then implement. Silent deviation is the single worst failure mode on this project.
    
5.  **No "while I'm here" changes.** Unrelated cleanup goes in its own `chore:` PR or into `BACKLOG.md`.
    

* * *

## 5. Code standards

*   TypeScript `strict: true`. No `any`, no `@ts-ignore`, no non-null `!` on user data.
    
*   **Validate at the boundary, trust inside.** Every request body, query param, and import row goes through Zod. Domain functions take typed values.
    
*   **Domain logic is pure and lives in** `services/` **or** `shared/`**.** No DB calls, no `Date.now()`, no randomness inside pure functions — inject them so they're testable.
    
*   **One responsibility per file.** Over 400 lines is a smell; split it.
    
*   **Errors are never swallowed.** No empty `catch`. Log with context, return a typed error code from the closed set in PRD §7.1.
    
*   **All timestamps are UTC epoch milliseconds, integers.** Never `Date` objects in the DB, never local time.
    
*   **No** `dangerouslySetInnerHTML`**.** Item names are user input and are rendered as text.
    
*   **Parameterized queries only.** No string-built SQL, ever.
    
*   **Mobile first.** Every UI change is checked at 375×667 and 390×844 before you call it done.
    
*   **Accessibility is not optional.** Real semantic elements, 44px targets, visible focus, `aria-checked` on the custom checkbox, respect `prefers-reduced-motion`.
    
*   **No magic numbers in the UI.** Use the tokens in `styles/tokens.css`.
    
*   **Copy comes from PRD §8.10.** Do not invent new microcopy; if you need a new string, add it to the copy deck in the same PR.
    

* * *

## 6. Testing ethics

1.  **Write the test with the feature, in the same commit.** A feature without a test is not done.
    
2.  **Tests must be deterministic.** No `Date.now()`, no random IDs, no network in unit tests. Use fixed fixtures.
    
3.  **Test behaviour, not implementation.** Assert on the public contract, not on private helpers.
    
4.  **Never weaken a test to make it pass.** If a test is genuinely wrong, fix it in a separate commit that explains why.
    
5.  **Never skip a failing test.** Fix it, or mark it with an issue reference and an ADR.
    
6.  **A flaky test is a bug.** Fix the flake; don't retry it into submission.
    
7.  **Run** `pnpm verify` **before every commit.** If it fails, you are not done.
    

* * *

## 7. Git hygiene

*   **Conventional Commits**, with a `Refs:` trailer citing PRD sections and task IDs.
    
*   One task card = one branch = one PR. Squash on merge. Rebase before merge. **Never force-push** `main`**.**
    
*   `main` is always deployable. If you break `main`, fixing it is your only task until it's green.
    
*   **The git log is the project's memory.** `git log --oneline --graph --decorate` must read as a coherent narrative: phase runs ending in annotated tags. Write commits for the next agent, not for yourself.
    
*   **Never commit:** secrets, `.env`, `*.db`, `node_modules`, build output, large binaries.
    
*   **Never rewrite published history** on a shared branch.
    
*   Tag at every phase gate: `phase-N-complete`, then `v1.0.0`.
    

* * *

## 8. Data ethics

1.  **Never lose user data.** Deletes are soft by default. Hard deletes require an explicit confirm in the UI and, for anything bulk, an undo window.
    
2.  **Migrations that drop or rename a column must write a** `.backup` **first.** Non-negotiable.
    
3.  **No telemetry, no analytics, no third-party scripts, no external fonts.** The app must work with the WAN unplugged.
    
4.  **No outbound network calls before P6.** When P6 lands, the only permitted destination is the user-configured LLM endpoint, and it must be off by default.
    
5.  **Never send household data to a model without the user having enabled it.** When enabled, prefer local models; document what leaves the box.
    
6.  **Logs contain no secrets and no item contents beyond what's needed for debugging.** Display names are acceptable; passcodes never.
    
7.  **The passcode is casual-access protection, not security theatre.** Say so in the README; don't overstate it.
    

* * *

## 9. Honesty & escalation

1.  **Never claim something works that you have not run.** "Tests pass" means you ran them and saw them pass.
    
2.  **Never invent an API, a library function, or a config key.** Verify it exists or don't use it.
    
3.  **Report estimates as ranges, and say what's uncertain.** False precision erodes trust.
    
4.  **When blocked, stop and write it down.** Add a `## Blocked` section to `STATUS.md` with what you tried and what you need. Do not guess your way past a blocker.
    
5.  **Flag assumptions immediately.** If you had to assume something, it goes in the phase log the same session.
    
6.  **Surface bad news early.** A slipping gate or a design flaw found late is far cheaper when reported at once.
    
7.  **Don't pad.** No filler comments, no restating the code in prose, no "TODO: implement" left in a merged PR without an issue reference.
    

* * *

## 10. Collaboration between lanes

| Lane | Owns | May not touch |
| --- | --- | --- |
| A — Backend | `server/**`, `db/**` | `web/**`, `shared/**` (without a contract PR) |
| B — Frontend | `web/**` | `server/**`, `db/**`, `shared/**` |
| C — Platform | `infra/**`, `.github/**`, `scripts/**`, `Dockerfile`, `docker-compose.yml`, lockfile | application code |
| D — QA/Docs | `e2e/**`, `docs/**` | application code |

1.  **Stay in your lane.** Cross-lane changes are requested in `docs/REQUESTS.md`, not made unilaterally.
    
2.  **Two agents never edit the same file in the same phase.** If it's unavoidable, one owns it and the other files a request.
    
3.  **Frontend starts against frozen contracts and mocks.** It does not wait for backend completion, and it does not invent response shapes.
    
4.  **Merge order within a phase:** contracts → backend → frontend → docs/E2E.
    
5.  **Never let a subagent expand its own brief.** If the task card's file list is insufficient, stop and file a request.
    

* * *

## 11. Session protocol

### Start of session (5 minutes)

```
1. Read AGENTS.md
2. Read docs/STATUS.md
3. Read docs/progress/PHASE-<current>.md
4. Read ADRs newer than your last entry
5. Confirm the current task card and its STOP WHEN condition
```

### End of session (mandatory, even if unfinished)

Append to `docs/progress/PHASE-N.md`:

```md
## <date> — lane <X> — <TASK-ID>
Built:      <what actually works now>
Tests:      <count + result + command>
Decisions:  <anything chosen that wasn't specified>
Deviations: <none | what and why + ADR ref>
Learned:    <the thing the next agent would otherwise rediscover the hard way>
Next:       <the single next task card>
```

Rewrite `docs/STATUS.md` (≤60 lines): current phase, done, in progress, blocked, next, contract state, migration lock.
**If you did not write these two things, your session did not happen.** The next agent's context depends entirely on them.

* * *

## 12. Definition of done (per task)

- [ ] Acceptance criteria met, with evidence
- [ ] Unit tests for new domain logic; integration test for new endpoints
- [ ] `pnpm verify` green locally
- [ ] Mobile viewport verified
- [ ] Keyboard-only path verified for touched screens
- [ ] No new dependency without justification
- [ ] `STATUS.md` + phase log updated
- [ ] Commit cites PRD sections

* * *

## 13. Things that will get a PR rejected

1.  Editing outside your lane.
    
2.  A contract change without an ADR.
    
3.  A migration without a claimed number or without a backup step for destructive changes.
    
4.  A new dependency with no justification.
    
5.  Tests that pass only because they were weakened.
    
6.  A UI screen with no empty/loading/error state.
    
7.  A tap target under 44px.
    
8.  A hard-coded string that isn't in the copy deck.
    
9.  `any`, `@ts-ignore`, or a swallowed error.
    
10.  "Also fixed an unrelated thing."
     
11.  Any outbound network call before P6.
     
12.  A commit that doesn't say which PRD section it implements.
     

* * *

## 14. Escalation ladder

| Situation | Action |
| --- | --- |
| Unclear requirement | Check PRD → check ADRs → use the §21 default → log the assumption → continue |
| Missing API/field | File in `docs/REQUESTS.md`, mock it, continue on the rest |
| Failing test you can't fix in 30 min | Stop, write it in `STATUS.md` under Blocked, move to the next unblocked task |
| Discovered a design flaw | Write an ADR _before_ coding around it |
| Tempted to add a feature | Write it in `docs/BACKLOG.md` and keep going |
| Gate cannot be met | Say so immediately with the specific gate ID and what's missing |

* * *

## 15. The one-line summary

**Read four files, stay in your lane, follow the contract, test what you ship, write down what you decided, and leave the repo easier for the next agent than you found it.**
