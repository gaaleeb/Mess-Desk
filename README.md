# MESS DESK

A local-first web app for a shared flat: fixed bills, bazar spending and daily meals in one place, with every money entry approved by a manager. Built from the "Mess Management App Plan" spec (spec sections 11–15 govern).

## Status: Phases 1–7 (full local version) built

Works today:

- **Landing page** (`index.html`): exactly three buttons — join, create, login. Forms live on `join.html`, `create.html` and `login.html`. Create shows a generated `MESS-XXXXXX` ID with copy button and a "Join as a member" checkbox, seeds the standard bill template; join waits for manager acceptance; login has a 5-attempt / 60 s lockout. The `login.html` footer carries the small "Load demo data" and "Admin" links
- **Member dashboard** (`member.html`): bills + meal status circles with word and amount, orange pending badge, pending strip, current-month meal table with 0.5-step counters (instant save, audit log), copy-yesterday and set-remaining-days, "Pay bills", "Add bazar cost" (multi-line, categories), "Settle meal balance" (capped at your meal debt), provisional meal rate label, opening balance carry-forward lines
- **My history**: last 6 months table (owed / paid / meals / meal cost / bazar / net) and own payments / bazar / meals lists with approval state and withdraw buttons; rejection reasons shown. (The 6-month chart was removed for now.)
- **Manager dashboard** (`manager.html`): summary tiles (bills due, collected, meal rate, bazar total, total meals, pending), "Numbers check OK" warning, join-request inbox (accept/decline), approvals inbox (filters by type/member/date, OK / edit / reject with reason, bulk "Approve all shown"), sortable member grid with "who is behind" filter and per-bill expansion, member detail with entry edit/delete, meal override, audit log, reset password, transfer manager role
- **Bill setup**: bill template (fixed/variable), "Generate this month's bills", variable amounts must be filled before Publish, published bills are marked and audit-logged when edited, split editor (equal with proration / percentage / fixed amounts, 100-sum and bill-sum validation, property of copying one bill's split to all bills), special bills
- **Month close**: closing snapshot frozen in `monthCloses`, blocks editing of the closed month, pending entries must be resolved first, reopen only the most recent closed month (logged), opening balances carry into the next month, CSV export and printable report

- **Demo data**: "Load demo data" on the login page creates "Demo Flat" with a manager (Rahim), three members, a closed previous month matching the spec's worked example (16,800 bills / 24,000 bazar / 240 meals / rate 100) and a live current month with pending entries. Log in as `Rahim / demo123`
- **Admin console** (`admin.html`, stub): access code `mess-admin-demo` (hardcoded in `js/config.js`), lists all messes with member count and last activity, soft-delete with typed confirmation and restore. Open it directly at `http://localhost:8000/admin.html`

Not built (by design): a real server / database / multi-device sync (phase 8, separate brief), weighted meal types, receipt photos, notifications, notice board, Bangla, PWA install (all out of scope for v1 — see spec section 15).

Study notes for the project defense (comprehension, not cosmetics): see `docs/` — architecture map, key code blocks, patterns, Q&A prep.

## How to run

ES modules need HTTP, not `file://`:

```sh
python -m http.server 8000
```

then open `http://localhost:8000`.

## Tests

```sh
node tests/calc.test.js    # 25 spec section-14 cases (money formulas)
node tests/flows.test.mjs  # end-to-end service flow: create, submit, approve, reject,
                           # withdraw, close, reopen, self-approve, permissions
node tests/smoke.test.mjs  # seeds the demo mess, opens every page module, checks the
                           # worked example end to end
```

Or open `http://localhost:8000/tests/index.html` for the browser runner. All 25 spec cases must pass before a change is called done.

## Rules enforced in code

- Money is integer taka; meals are stored as integer half-meals; dates are `YYYY-MM-DD`; months are `YYYY-MM`
- Only `js/storage.js` touches `localStorage`; only `js/calc.js` contains money formulas
- Bill/meal shares use largest-remainder rounding (ties go to the earliest join date) so shares always add up exactly
- Proration (days present / days in month, join and leave days counted) applies to the equal split only
- Every money write passes through `js/approvals.js`, which checks `can(user, action, entity)` from `js/auth.js`, enforces the validation table (amount ranges, date window, settlement ≤ debt, closed-month lock), and writes the audit log
- Permission logic follows the spec's section-1 table; a manage-only manager can approve but cannot submit entries
- Totals are always recomputed from approved rows; only `monthCloses` freezes a snapshot

## Local-version limits

- Data lives in one browser on one device; other phones/laptops never see it
- Not secure; password hashing (PBKDF2 via SubtleCrypto, SHA-256, 100k iterations, random salt) is demo-only and HTTPS/localhost-only
- Login lockout (5 wrong attempts, 60 seconds) is kept in memory only — a reload clears it
- Admin page is only a stub (fixed code in `js/config.js`); there is no shared place to see all messes
- The real version needs the server phase (spec section 8), which is briefed separately
