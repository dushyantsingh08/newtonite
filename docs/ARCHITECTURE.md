# Architecture Overview

## System Overview
The Operations Work Manager is a monolithic Next.js application using App Router. It is designed to be highly reliable, consistent, and maintainable.

```
Browser (React / TanStack Query)
   ↓
Next.js API Routes
   ↓
Service Layer (Idempotency, Authz, Workflow)
   ↓
Prisma ORM
   ↓
PostgreSQL (Source of Truth)
```

## Concurrency
We handle concurrent modifications using an explicit `version` column.

```
Client (reads version 5)
       ↓
DB (another user updates, version becomes 6)
       ↓
Client (submits update with expectedVersion = 5)
       ↓
Server (UPDATE ... WHERE id = ? AND version = 5) -> 0 rows updated
       ↓
409 Conflict (STALE_VERSION)
```

## Atomic Claiming
Two users claiming at the same time:
```
Alice ─┐
       ├── atomic DB UPDATE (assignee_id = ? WHERE assignee_id IS NULL) ──> exactly one winner
Bob ───┘
```
The loser receives a `409 ASSIGNMENT_CONFLICT`.

## Idempotency
To handle lost network responses, we support `Idempotency-Key` headers on mutations.
1. Check `idempotency_keys` table.
2. If exists and hash matches, return stored JSON response.
3. If new, run mutation inside a transaction.
4. Store result in `idempotency_keys`.

## Authorization
Policy is resource-level. An API route does not just check "is this user logged in?". It delegates to the Service Layer, which fetches the resource and asserts `requireEditAccess(user, resource)`.

List endpoints inherently scope results in the SQL query:
```sql
SELECT * FROM work_items WHERE team_id IN (SELECT team_id FROM memberships WHERE user_id = current)
```
This prevents information leakage and ensures pagination works correctly.
