# Authentication

## Overview

- **`src/routers/AuthGuards.ts`** - API-level authentication for ORPC procedures (uses `guard*` functions)
- **`src/utils/Auth.ts`** - Page-level authentication for Next.js App Router (uses `require*` functions)

## Naming Convention

### Ensure vs Guard

- **`guard*`** functions guard API access, throwing errors if unauthorized
- **`require*`** functions ensure users are in the correct state, redirecting if needed

## When to Use Each

### Use `AuthGuards.ts` for:

- ORPC router procedures
- API endpoints that should return HTTP status codes
- Server-side functions that shouldn't redirect
- Any context where you need proper error responses

### Use `Auth.ts` utilities for:

- Components used in Next.js App Router
- Route handlers that should redirect users
- Any context where you want to redirect unauthenticated users
