# Phase 2: Asynchronous Evolution

Currently, the Operations Work Manager is purely synchronous. Every action completes fully within the HTTP request lifecycle. 

While this guarantees strong consistency and is perfect for Phase 1, it introduces bottlenecks if we need to send emails, trigger webhooks, or perform heavy data enrichment.

## Target Architecture

We will implement a Transactional Outbox pattern.

```text
Primary Transaction
      |
      +--> UPDATE work_items
      |
      +--> INSERT item_events
      |
      +--> INSERT outbox_events (NEW!)
                |
                v
             Worker (polls or listens)
                |
         +------+------+
         |             |
       Email        Webhook
```

## Why an Outbox?
If we send an email *during* the transaction, and the transaction rolls back, we sent a phantom email.
If we send an email *after* the transaction, and the server crashes before sending, the email is lost forever.
By writing an `outbox_events` row in the *same* PostgreSQL transaction as the data mutation, we guarantee the event is recorded if and only if the business state changes.

## Worker Design
A background worker will process the outbox:
1. Claim an outbox row (using `SELECT FOR UPDATE SKIP LOCKED` in Postgres).
2. Attempt delivery (e.g., calling SendGrid).
3. If successful, mark the outbox row as processed.
4. If failed, increment retry count and use exponential backoff.

## Idempotent Consumers
Delivery is **at-least-once**. The worker might crash *after* sending the email but *before* marking it processed. It will retry. 
Therefore, downstream consumers (like webhooks) must be designed idempotently, ignoring duplicate event IDs.

## Dead-Letter Handling
If an event fails repeatedly (e.g., 10 times), it will be moved to a `dead_letter` state for manual operator intervention, ensuring the worker queue isn't blocked by a poison pill.
