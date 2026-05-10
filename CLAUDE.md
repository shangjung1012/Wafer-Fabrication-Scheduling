# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Package manager:** pnpm

```bash
# Development
pnpm dev          # Start Next.js dev server (localhost:3000)
pnpm build        # Production build
pnpm lint         # ESLint

# Database
docker compose up -d   # Start PostgreSQL 17
pnpm db:migrate        # Run Prisma migrations
pnpm db:generate       # Regenerate Prisma client after schema changes
pnpm db:deploy         # Deploy migrations (production)
pnpm db:seed           # Seed test data
pnpm db:studio         # Launch Prisma Studio (visual DB browser)
```

**API docs:** http://localhost:3000/docs (Swagger UI)

## Architecture

Three-layer architecture with strict dependency direction:

```
app/api/*  →  modules/*  →  infra/db/*  →  prisma/schema.prisma
```

- **`app/`** — Next.js App Router: UI pages + API route handlers. No business logic here.
- **`modules/`** — Domain/service layer: auth, RBAC enforcement, business logic.
- **`infra/db/`** — Prisma repository layer: all DB access is isolated here.
- **`lib/`** — Shared utilities (e.g., Prisma client singleton).
- **`prisma/`** — Schema and migrations.
- **`.cursor/docs/`** — Authoritative domain documentation (see below).
- **`.cursor/rules/`** — Team coding standards.

## Domain

This is a wafer factory order scheduling system with three factory production types (A, B, C), each having multiple factories. The key models:

- **User**: Roles SUPERADMIN | ADMIN | SALES. ADMINs are scoped to specific factories.
- **Order**: Parent order with lifecycle `PENDING → APPROVED → SCHEDULED → IN_PRODUCTION → COMPLETED`.
- **OrderAssignment**: Child dispatch units assigned to specific factories.
- **DailyCapacity**: Per-factory, per-day capacity tracking used by the scheduler.

## Auth

Hybrid JWT + dev token system. In development, skip full auth with tokens in the form:
```
Authorization: Bearer dev:<ROLE>:<userId>
```
Example: `Bearer dev:SUPERADMIN:sa-A` (user IDs are created by `pnpm db:seed`).

## Key Docs (read before working on a subsystem)

All located in `.cursor/docs/`:

| File | When to read |
|------|-------------|
| `architecture.md` | General orientation |
| `domain_rbac.md` | Adding/editing any authorization logic |
| `orders_lifecycle.md` | Touching order status transitions |
| `scheduling_conflicts.md` | Scheduling or capacity logic |
| `api_conventions.md` | Adding or modifying API routes |
| `prisma_conventions.md` | Modifying the DB schema or queries |
| `auth_jwt.md` | Auth middleware or token handling |

## Coding Rules (`.cursor/rules/`)

- **`01_project_structure.md`** — File placement rules (no business logic in `app/`, no DB calls in `modules/`)
- **`02_security_rbac_jwt.md`** — Every API route must enforce RBAC via `modules/auth`
- **`03_prisma_db_access.md`** — All DB access through `infra/db/` repositories, never raw Prisma in routes
- **`04_api_style_error_handling.md`** — Standardized error shapes and HTTP status codes
- **`05_scheduling_rules.md`** — Conflict detection, versioning, capacity constraints
- **`06_testing_minimum.md`** — Minimum testing requirements per feature type

## OpenAPI Spec

`api_spec.yml` at the repo root is the single source of truth for the API contract. Routes must stay in sync with it. The spec is served at `GET /api/docs/spec`.

## Environment

Copy `.env.example` to `.env`. Required vars: `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `JWT_SECRET`, `DEV_STATIC_TOKEN`.
