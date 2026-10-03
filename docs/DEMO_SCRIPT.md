# Demo Script (5-10 minutes)

## 1. Login & Dashboard (1 min)
- Log in as `admin@example.com` / `password123`.
- Show the Dashboard. Explain the "Needs Attention" inbox and how the numbers reflect active, critical, and unassigned work.
- Demonstrate filtering by Priority and Status using the dropdowns. Notice the URL updates, making filters shareable.
- Perform a search for "investigate" to show database-backed full-text search capability.

## 2. Work Item Detail & History (2 min)
- Open a work item.
- Point out the Details sidebar (Status, Priority, Requester, Assignee, Version).
- Scroll down to the Activity Timeline. Show how it currently has a CREATED event.
- Add a comment: "Looking into this now." Show it appearing instantly in the timeline.
- Emphasize: *The timeline is append-only and transactionally bound to the state changes.*

## 3. Core Reliability: Atomic Claim (2 min)
- Explain the "Claim" button.
- *Story:* "If two users click this exact button at the exact same millisecond, Node will run the requests concurrently. We do not do a SELECT then an UPDATE. We do an atomic `UPDATE ... WHERE assignee_id IS NULL`. The database locks the row, the first wins, and the second gets a 409 Conflict."
- Click "Claim & Start". The UI optimistically updates. The timeline records the `ASSIGNED` and `STATUS_CHANGED` events.

## 4. Core Reliability: Stale Update (2 min)
- *Story:* "What if I leave this tab open, go to lunch, and someone else edits the item? When I come back and click 'Mark Resolved', I might overwrite their work."
- Show how every mutation sends an `expectedVersion`. 
- If the server version has incremented, the server rejects the request with a `STALE_VERSION` error. The frontend catches this, alerts the user, and automatically refetches the latest state.

## 5. Workflow & Approval (1 min)
- Find or create an item that `requiresApproval = true`.
- Move it to `In Progress`, then click `Request Approval`. Status becomes `WAITING_APPROVAL`.
- Explain that as the Requester, I cannot approve my own item (Server-side validation).
- Explain that a Lead must approve it before it can transition to `RESOLVED`.

## 6. Architecture & Evolution (2 min)
- Briefly mention the 5 Engineering Decisions (Postgres as Source of Truth, Optimistic Concurrency, Atomic Claim, Append-Only History, Centralized Authz).
- **Phase 2 Evolution:** Explain that the system is currently completely synchronous. If we want to add email notifications later, we won't put `sendEmail()` inside the API route. We will use a Transactional Outbox pattern to write an `outbox_events` row in the same Postgres transaction, and a background worker will process it with at-least-once delivery semantics.
