# Operations Work Manager

**🚀 Live Demo:** [https://newtonite.vercel.app/](https://newtonite.vercel.app/)

A reliable, full-stack Next.js application for coordinating internal operational work. Built for the Newtonite Software Engineering Challenge.

## Features
- **Authentication:** Custom JWT-based authentication.
- **Authorization:** Centralized, resource-level RBAC (Admin, Lead, Member, Viewer).
- **Concurrency:** Optimistic concurrency (versioning) to prevent stale overwrites.
- **Atomic Operations:** Race-condition-free claiming using atomic database updates.
- **Idempotency:** Safe retry handling for mutations.
- **Workflow Engine:** Explicit status transition rules and minimal approval workflows.
- **Audit Timeline:** Transactional, append-only history of all state changes.
- **Performance:** Database-side filtering, search, and keyset/cursor pagination.

## Architecture
- **Frontend:** Next.js App Router, React, Tailwind CSS, TanStack Query.
- **Backend:** Next.js Route Handlers.
- **Database:** PostgreSQL (Source of Truth) via Prisma ORM.

## Prerequisites
- Node.js (v20+)
- Docker & Docker Compose (for PostgreSQL)

## Local Setup

1. **Clone and Install**
   ```bash
   npm install --legacy-peer-deps
   ```

2. **Environment**
   ```bash
   cp .env.example .env
   ```

3. **Database Setup**
   Start the PostgreSQL container:
   ```bash
   docker compose up -d
   ```
   Generate the Prisma client and push the schema:
   ```bash
   npx prisma generate
   npx prisma db push
   ```
   Seed the database with demo data:
   ```bash
   npm run db:seed
   ```

4. **Run Application**
   ```bash
   npm run dev
   ```
   Access at `http://localhost:3000`.

## Demo Accounts

All accounts use the password: `password123`

- **Admin:** `admin@example.com`
- **Payments Lead:** `manager.payments@example.com`
- **Member:** `alice@example.com`
- **Member:** `bob@example.com`

## Testing & Validation
Run type checking and linting:
```bash
npm run build
```

## Known Limitations
- **No real-time WebSockets:** UI requires manual refresh or relies on TanStack Query polling interval.
- **No email/notifications:** Infrastructure for async workers is documented but not implemented in Phase 1.
- **Basic Search:** Uses `ILIKE` on title/description. For massive scale, a true `tsvector` column should be added via raw SQL migration.
- **No SSO/OAuth:** Uses seeded local credentials for demo purposes.

## Future Improvements (Version 2)
If granted additional development time, the following architectural upgrades would be prioritized:
1. **True Real-time Synchronization (SSE):** Replace polling with Server-Sent Events for instant UI updates.
2. **Asynchronous Task Queue:** Implement a dedicated message broker (e.g., BullMQ) for secondary effects like email notifications without blocking the HTTP request thread.
3. **Cursor-Based Infinite Scroll:** Enhance the frontend to consume the backend's already-implemented cursor pagination for navigating historical work items.
4. **Full-Text Search Integration:** Offload complex text searching from Postgres `ILIKE` queries to a dedicated search index (like Elasticsearch) for fast, typo-tolerant querying.
