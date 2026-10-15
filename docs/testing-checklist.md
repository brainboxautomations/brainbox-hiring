# Manual testing checklist

Every requirement area, with the path that should work and the paths that should
fail well. Work through it in order — later sections assume earlier ones left
data behind.

**Staging:** `https://<your-staging-host>`

> **Read "Known gaps" at the bottom first.** Seven things are known and not to be
> reported. Reporting them again costs you time.

## Before you start

- [ ] A real email inbox you control, for playing the candidate
- [ ] A second one, to test two candidates on one position
- [ ] Slack open on the channel the bot posts to
- [ ] Two browser profiles or a private window, so you can be staff and candidate at once

**How to report:** what you did, what you expected, what happened, and the URL.
A screenshot of the wrong state beats a description of it.

---

## 1 · Positions

### Happy path

- [ ] Create a position through all five wizard steps, save as draft
- [ ] Fill every Details field — title, department, **two or more locations**, remote, type, education level and whether it is required, experience, salary range with period and currency
- [ ] Assign a pipeline; confirm the stages appear
- [ ] Confirm a stage is now just a **name and a position in the order** — there is no Active / Success / Terminal picker anywhere
- [ ] Set an automated sender name
- [ ] Publish as **listed**; it appears on `/careers`
- [ ] Edit the position after publishing; changes save
- [ ] Move it draft → open → closed → archived

### Should fail well

- [ ] Save with no title — refused, with a message naming the field
- [ ] Salary minimum above maximum — refused, **not silently swapped**
- [ ] Try to reassign the pipeline on a live position — the control should not be offered at all (the stage order is frozen once a position is open)
- [ ] Close a position that has candidates — **nobody is moved and nobody is emailed.** Closing is not a notification.
- [ ] Publish as **unlisted** — absent from `/careers`, reachable by direct link
- [ ] Publish as **disabled** — the direct link stops working too

---

## 2 · Public careers and application

### Happy path

- [ ] `/careers` lists only open + listed roles, with branding and hero
- [ ] Open a role; the description and details render
- [ ] Apply with name, email, phone, a **resume upload**, and any configured fields
- [ ] Answer an embedded questionnaire as part of the application
- [ ] **Record a video answer in the browser**, and separately paste a hosted video link
- [ ] Confirmation screen appears
- [ ] The candidate appears on the board at stage 1, with the resume viewable and the video playable on their profile

### Should fail well

- [ ] Submit with no name or no email — refused
- [ ] Upload something that isn't a document as a resume — refused
- [ ] Upload a very large file — refused with a size message, not a hang
- [ ] Paste a video link from a site that isn't allowed — refused
- [ ] Apply to a **closed** position by direct link — refused
- [ ] **Apply twice with the same email.** You get the confirmation screen, but nothing changes on the existing application. See Known gaps #3 — this is deliberate, not a bug.
- [ ] Apply with the same email to a **different** position — a second application on the same person, both visible from the profile switcher

---

## 3 · Board, profile and filters

### Happy path

- [ ] Drag a candidate between stages; the move sticks after a refresh
- [ ] Star a candidate; the star survives a refresh
- [ ] Open a candidate — they become "seen"
- [ ] Every profile tab: Experience, Resume, Documents, Questionnaires
- [ ] Play a video answer inline
- [ ] Add an internal note
- [ ] Edit custom attributes
- [ ] Switch positions from the profile when the person has applied to two
- [ ] **Prev / next** through candidates, matching the filtered order the board showed
- [ ] Every filter: stage, added date, last activity, starred, unseen, include archived, and free-text search on name and email

### Should fail well

- [ ] Filter to something with no matches — a real empty state, not a blank page
- [ ] **Every stage is its own column**, including rejection stages. There is no collapsed "Closed / rejected" strip any more — a pipeline with eight stages shows eight columns and scrolls sideways
- [ ] Drag a candidate into a rejection column and back out; it behaves like any other column
- [ ] **Prev / next order matches the columns left to right**, rejection stages included
- [ ] Open prev/next from the Inbox instead of the board — **no navigation offered**, because there is no filter context
- [ ] Archive a candidate, then find them again with "include archived"
- [ ] **Go offline, then change a stage** — it must show an error and revert. It must **not** show the new stage as if it worked.
- [ ] Same test for starring, notes, and custom attributes

---

## 4 · Email and Inbox

### Happy path

- [ ] Compose to a candidate from their profile; it arrives in your real inbox
- [ ] Compose from the Inbox as well
- [ ] Use **merge variables** — check they resolve in the delivered email, not just in the composer
- [ ] Attach a file; confirm it arrives
- [ ] Send with **CC and BCC**
- [ ] **Reply from your real mail client.** It appears in the Inbox, threaded, and on the profile.
- [ ] Reply again — the thread keeps growing in order
- [ ] Global inbox and per-position inbox both list most-recent-first
- [ ] **Schedule a send** for a few minutes out, then wait. It sends.
- [ ] **Schedule and then cancel.** It never arrives.
- [ ] Create a template with merge variables; use it in compose

### Should fail well

- [ ] Send with an empty subject and body — refused
- [ ] Merge variable for a field the candidate has not filled — resolves to blank or a fallback, never `{{candidate.phone}}` in the delivered mail
- [ ] Schedule a send **in the past** — refused
- [ ] Cancel a scheduled message **after** it has sent — refused, with a message saying it already went
- [ ] Email the app from an address that belongs to no candidate — it lands in **unmatched**, not dropped and not attached to the wrong person
- [ ] Reply changing the subject line — it should still thread (a fallback handles this)

---

## 5 · Questionnaires

### Happy path

- [ ] Build a template using **all ten question types**
- [ ] Set required and optional questions
- [ ] Set a video question's max duration and whether retakes are allowed
- [ ] Set numeric min/max on a number question
- [ ] Attach one to a position's application form
- [ ] Send one from a stage action, and separately from the board's bulk bar
- [ ] Open the emailed link, answer, and submit
- [ ] The profile shows it **completed**

### Should fail well

- [ ] Submit with a required question blank — refused
- [ ] Enter a number outside the min/max — refused, both on the hosted questionnaire page and on the application form
- [ ] **Open the same link twice after submitting** — refused; answers cannot be overwritten
- [ ] Edit a token in the URL — refused
- [ ] Record a video, retake it, submit the retake
- [ ] Leave the page mid-questionnaire and return via the link — behaves sensibly

---

## 6 · Automation and reminders

**The highest-risk area. Use short delays so you aren't waiting an hour.**

### Happy path

- [ ] Add a **send email** action to a stage with a 1–2 minute delay
- [ ] Move a candidate in; the email arrives after the delay, **not immediately**
- [ ] Add several actions to one stage with different delays; each fires on its own schedule
- [ ] Add a **move to stage** action; the candidate moves
- [ ] Add a **send questionnaire** action with reminders enabled
- [ ] Configure answer routing on a choice question; complete the questionnaire; **the candidate moves to the routed stage**
- [ ] Apply through the public form — the first stage's actions fire

### Should fail well — these are the ones that matter

- [ ] **Move a candidate in, then straight back out before the delay elapses.** The email must **never arrive**.
- [ ] **Move a candidate out and back into the same stage.** Actions must **not** fire a second time.
- [ ] Complete a questionnaire that has reminders — **the remaining reminders stop**
- [ ] Move a candidate out of a stage with pending reminders — **the reminders stop**
- [ ] Let reminders run to their maximum — they stop, and do not continue forever
- [ ] Delete a pipeline template stage that an answer-routing rule points at, then complete the questionnaire — **the candidate stays exactly where they are.** It must not guess a stage.
- [ ] Archive a candidate with pending actions — nothing fires for them

---

## 7 · Bulk actions

### Happy path

- [ ] Select several candidates by hand; move them all to another stage
- [ ] Select by filter, then **Select all**
- [ ] Bulk archive
- [ ] Bulk export — open the CSV and check the columns
- [ ] Bulk send email — **each recipient gets their own message**
- [ ] Bulk send questionnaire — each candidate gets their **own link**
- [ ] "Email all candidates on this position" from the positions menu

### Should fail well

- [ ] **Check a delivered bulk email's recipients.** Nobody should see anyone else's address — no shared To, no CC, no BCC list.
- [ ] **Swap two candidates' questionnaire links.** Each link must resolve only to its own candidate.
- [ ] Select more than 500 — you are told the cap and what was selected. Nothing is silently dropped.
- [ ] Bulk send a questionnaire to someone who already completed it — **skipped by name**, not sent again
- [ ] Bulk send to someone with a pending one — they get a fresh link, and the old link stops working
- [ ] Open a CSV export in Excel and confirm no cell is treated as a formula

---

## 8 · Slack

- [ ] A candidate reply posts a notification to the channel
- [ ] The notification links somewhere useful
- [ ] A **stage move** posts nothing. An **outbound email** posts nothing. Only inbound candidate mail.
- [ ] Turn Slack off in Settings — replies still record, nothing posts
- [ ] Turn it back on with a **wrong channel id** — email still records, and the failure is visible somewhere rather than silent

---

## 9 · Reports

The whole screen was rebuilt. There are no Hired / Rejected / In pipeline figures
anywhere any more — stages are counted, never classified.

### Happy path

- [ ] One card at the top: **Applications received**, for the current month
- [ ] Applications received **by week** — four bars, W1 to W4
- [ ] **One card per position**, each listing that position's own stages with counts
- [ ] Stages appear in **pipeline order** — the same order as that position's board, not alphabetical and not biggest-first
- [ ] Change the month — **every card and chart changes together**
- [ ] Apply as a new candidate, then reload — applications received goes up by one, and that position's first stage goes up by one
- [ ] Move a candidate between stages, reload — the counts shift between the two stages, and the position's total is unchanged

### Should fail well

- [ ] Pick a month with no applications — an empty state, never `NaN` or a broken chart
- [ ] A position whose only applicants are archived — shows the position with no stage bars, not a broken card
- [ ] **Archive a candidate, then reload.** They leave their stage bar but applications received does **not** drop, and a footnote appears explaining the difference
- [ ] **Add up one position's stage counts.** It equals that position's applications received **minus** its archived applications — the footnote says so
- [ ] **Two positions with the same title** both appear as separate cards. They must not be merged into one
- [ ] A candidate on a position with no pipeline assigned appears under **"No stage"** rather than vanishing

## 10 · Settings and access

- [ ] Users section lists real accounts
- [ ] Slack section saves a channel and a token
- [ ] Email section shows the real relay address and company details
- [ ] **The Slack token is never displayed back** after saving
- [ ] Sign out; every internal page redirects to login
- [ ] Paste an internal URL while signed out — redirected, not shown
- [ ] Sign in as a second user — they see **everything** the first sees, because there are no roles by design

---

## Known gaps — do not report these

| # | What you'll see | Why |
|---|---|---|
| 1 | **No way to mark a candidate unseen** | Once opened, they stay seen. The "unseen only" filter degrades over time. |
| 2 | **Hiring team can't be set anywhere** | The field exists in the database with no UI. |
| 3 | **Re-applying with the same email changes nothing** | Deliberate: an email address isn't proof of identity, so a re-submission can't overwrite an existing application. |
| 4 | **A scheduled message shows as the Inbox thread preview before it sends** | Known; the preview takes the newest message regardless of status. |
| 5 | **Bulk email can't be scheduled** | Individual sends can. |
| 6 | **Stage actions run only the first time a candidate enters a stage** | By design. Moving someone out and back in does not run that stage's actions again, including ones cancelled by the first exit. |
