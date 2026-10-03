# Engineering Decisions

## 1. PostgreSQL as the Source of Truth
Decision: We are using PostgreSQL as the authoritative source of truth, avoiding the introduction of Redis for caching, Elasticsearch for search, or Kafka for events in Phase 1.

Alternatives: Use Elasticsearch for full-text search and complex filtering.
Why: The challenge requires a robust but understandable system. Introducing Elasticsearch adds operational complexity and consistency challenges (split-brain data) without a proven immediate need. PostgreSQL's GIN indexes and structured querying can easily handle tens of thousands of records.
Trade-offs: Search won't have typo-tolerance out of the box like Algolia/ES, but the system remains transactionally perfectly consistent.

## 2. Optimistic Concurrency with Compare-and-Set
Decision: Every WorkItem has an explicit integer `version` field that increments on every mutation. Clients must send the `expectedVersion` they last read.

Alternatives: Last-write-wins (silent overwrite), or pessimistic row locking (`SELECT FOR UPDATE` held across HTTP requests).
Why: Pessimistic locking over HTTP is an anti-pattern. Last-write-wins silently destroys data in a collaborative environment. Compare-and-set provides safety without blocking readers.
Trade-offs: Clients must handle HTTP 409 Conflict and present the user with options to merge or discard changes.

## 3. Atomic Assignment for Concurrent Claims
Decision: The `claim` action is not a `SELECT` followed by an `UPDATE`. It is a single atomic `UPDATE ... WHERE id = X AND assignee_id IS NULL`.

Alternatives: Relying on application-level mutexes or naive sequential queries.
Why: If two users hit the claim button simultaneously, Node.js will execute the route handlers concurrently. Only the database's ACID properties guarantee exactly one winner.
Trade-offs: Requires a dedicated database operation rather than relying on an ORM's basic `save()` method, but ensures absolute correctness.

## 4. Append-Only Item Event History
Decision: The `item_events` table is append-only. History events are created in the same database transaction as the state change they represent.

Alternatives: Asynchronous event generation (e.g., via background worker) or updating a JSON column on the work item.
Why: If a state change succeeds but the event write fails, the audit log is corrupted. Using PostgreSQL transactions ensures the event timeline perfectly matches reality.
Trade-offs: Increases the size and duration of the primary transaction slightly.

## 5. Centralized Resource-Level Authorization
Decision: Authorization logic is centralized in `src/server/authorization/index.ts` rather than being scattered inside React components or individual API routes. Queries are inherently scoped (`teamId: { in: authorizedTeamIds }`).

Alternatives: Checking UI state or relying purely on API middleware that doesn't inspect the specific resource.
Why: If an API allows patching any item, a user might guess an ID and modify it. By enforcing that `getWorkItem` and `updateWorkItem` internally call `requireEditAccess(actor, item)`, security cannot be bypassed.
Trade-offs: Requires fetching the item first before mutating it, which adds a slight read overhead before the write.

## Deliberately Not Built
- **Real-time WebSockets**: Complex to scale, not strictly required for correctness. We rely on optimistic UI updates and TanStack Query polling/refetching.
- **Microservices**: A single Next.js monolith with proper boundaries (`/server/services`) is far easier to maintain and deploy.
- **Complex Dynamic Workflow Engine**: We implemented explicit, hardcoded transition rules rather than a drag-and-drop workflow builder.
