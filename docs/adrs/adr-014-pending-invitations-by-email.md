# ADR-014: Pending Invitations by Email for Users Without an Account Yet

* **Status**: Accepted
* **Date**: 2026-09-27
* **Deciders**: MemTrace Core Team

## Context and Problem Statement

ADR-013 added invitation endpoints (`POST /organizations/{id}/members`, `POST /experiments/{id}/members`), but they only worked if the invitee had already logged in at least once via Google/Microsoft — Auth.js only creates a `users` row on first login, so `getUserByEmail` returned nothing for anyone new, and the endpoint answered 404 with "ask them to sign in first". That is backwards: the whole point of an invite is to be able to bring in someone who has never used MemTrace.

## Decision Outcome

### 1. Invitations are stored even when the user doesn't exist

A new `pending_invitations` table (email, target — organization or experiment —, role, invited-by) records the intent independently of the `users` table. The invitation endpoints now branch on whether `getUserByEmail` finds the invitee:

- Found → unchanged behavior (membership row inserted immediately).
- Not found → insert a `pending_invitations` row and send an email, respond `202 Accepted` instead of `201 Created`.

### 2. Applied automatically on first login, not via a separate "accept" flow

Auth.js's `events.createUser` hook (`api/src/auth.ts`) fires exactly when the adapter inserts a new `users` row — i.e. the invitee's first successful OIDC login. That hook calls `applyPendingInvitations(userId, email)`, which inserts the corresponding membership row(s) and deletes the matching `pending_invitations` rows in one transaction.

No invitation token, no "accept" link, no separate acceptance step: the invite email just tells the person to sign in with Google/Microsoft, and being invited *is* the access grant once they do. This matches how access already works for existing users (an org_admin/admin invite is immediate) and avoids a second, parallel auth mechanism (invitation tokens) next to OIDC.

### 3. Email delivery: Resend

**Resend** sends the invitation email, behind a new `EmailSender` port (`api/src/application/ports/email-sender.ts`) — same repository-interface pattern as `IdentityRepository`/`TraceRepository`. Chosen for the simplest integration from Next.js with no extra infrastructure (no SMTP server to run). Configured via `RESEND_API_KEY` / `EMAIL_FROM` in `.env`.

The email sender is constructed eagerly in `getIdentity()` but only reads env vars lazily used at send time — a missing `RESEND_API_KEY` must not break the (far more common) authenticated read/write requests that call `getIdentity()` for identity/authorization only.

### 4. What this does not solve

- No re-send/expiry of pending invitations — they live forever until consumed or manually deleted. Fine for the current scale (invite-only, small teams); revisit if this becomes self-serve.
- No revoking a pending invitation from the UI yet.
- The email itself is a static HTML string, not a template system — acceptable for one email type.

## Consequences

- **Positive**: invitations work for anyone with an email, not just people who already tried MemTrace once. No new auth mechanism — first OIDC login is the only "accept" step.
- **Negative**:
  - New external dependency (Resend) and a new required secret for the invite feature to work end-to-end (other endpoints keep working without it).
  - `pending_invitations` has no TTL/cleanup — an org that invites a wrong email address accumulates a stale row indefinitely.
