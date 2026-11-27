# PyraHash Cards: SaaS MVP build prompt

Paste everything below the line into an AI coding agent (for example Claude Code)
started in a **new, empty repository**. Fill in the `[brackets]` first.
It covers Phase 1 (MVP) of the SaaS plan. Phase 0 (pilots) is business work, not code.

---

````markdown
# Build "PyraHash Cards": a multi-tenant SaaS for company-managed digital business cards (MVP)

## Context
We are PyraHash, a Malaysian startup. We have a working single-company prototype
(Google Sheets + Apps Script + Google Wallet) in the repo `BryanChan0528/flashcard`.
Reuse from it:
- `web/card/index.html`: the card page design (dark theme, 3D flip card, animated
  cyan-to-violet edge, staggered entrance, QR dialog, vCard download, WhatsApp button).
  This becomes the "Neon" theme.
- `Code.gs`: Google Wallet Generic pass logic (service-account JWT, insert object via
  REST then sign a save JWT that references only the object ID; PATCH to update),
  vCard building (full name kept as typed in the N given-name field), WhatsApp wa.me
  link logic (local numbers get country code 60). Port these to TypeScript.
Brand tokens: bg #07090F, surface #0D1120, accent #00E5FF, violet #7C3AED,
text #F0F4FF / #8892AA, fonts Inter + Space Grotesk.

## Goal
Ship an MVP where a company signs up, adds its staff, and each staff member gets a
branded digital card with QR code, contact saving, WhatsApp, and Google Wallet pass,
billed per seat. Pitch: "Never lose a lead or a client when someone leaves."

## Stack (use these unless you have a strong reason; ask me first)
- Next.js (App Router, TypeScript, Tailwind), deployed on Vercel
- Supabase: Postgres, Auth (email magic link + Google sign-in), Storage for photos/logos
- Row-level security on every tenant table, keyed by org_id
- Stripe Billing: per-seat subscription, Stripe Checkout + Customer Portal, webhooks
- Background work: Vercel Cron / queued jobs for Wallet sync and CSV imports
- Zod for validation, Vitest for unit tests, Playwright for e2e

## Data model (propose the exact schema + RLS policies before writing code)
orgs, users, memberships (role: owner | admin | member), cards (random public id,
org_id, member_id nullable, display fields, whatsapp, status: active | redirected |
archived, redirect_to_card_id, design jsonb), org_branding (logo, colours, company URL,
design_policy jsonb: allowed theme ids, locked theme id or null, allow personal accent),
card_events (view | save_contact | qr_open | whatsapp_click | wallet_click),
leads (card_id, name, phone, email, note, consent_at), wallet_passes
(card_id, object_id, save_link, synced_at, last_error), subscriptions (org_id,
stripe ids, seats, status), integrations (org_id, provider, connected_by,
connected account email, granted scopes, encrypted refresh token, status,
last_synced_at, last_error), audit_log (who changed what).

## Card design system (important: design is DATA, never HTML)
- A card's look is a versioned `CardDesign` JSON object validated by a Zod schema,
  for example: { version, themeId, accent, mode: light|dark, motion: on|off }.
  Later phases add layout, font pairing, background pattern and section order to the
  same schema; design the schema so it can grow without breaking saved cards.
- Our code renders every card from that JSON. Users can never supply raw HTML, CSS
  or scripts.
- MVP themes: Neon (port of the prototype), Minimal (white, no animation),
  Classic (printed business card look), Gradient (cyan-to-violet, white text).
- Every theme must keep: Save contact, QR, WhatsApp, Add to Wallet, Visit company;
  WCAG AA text contrast (check the accent automatically and pick black or white text);
  prefers-reduced-motion support; works at 320px wide.
- Brand lock: admins choose which themes staff may use, or lock everyone to one.
  The server enforces the policy, not only the UI.
- Theme picker in the staff dashboard with a live phone-sized preview.

## Integrations (MVP part)
- Sign in with Google (Supabase Auth) asking only for openid, email, profile.
- "Import staff from Google Sheet": Google Picker + the `drive.file` scope only
  (the user picks one spreadsheet; we can open only that file). Request the scope with
  incremental authorization the first time someone clicks Import, not at sign-in.
  Never request full Drive scopes (`drive`, `drive.readonly`): they are restricted and
  need a paid yearly security assessment.
- Reuse the CSV import preview/validation for Sheets imports (same column names as the
  prototype's Employees tab; headers matched case-insensitively).
- Optional "Keep in sync" for the picked sheet: scheduled re-import (every few hours)
  that shows a diff (added, changed, removed) and applies only after admin approval
  unless the admin turns on auto-apply.
- Integration status UI: connected account, last sync time, staff count, Sync now,
  Disconnect (revokes the token at Google and deletes it from our store).
- Tokens: encrypt refresh tokens at rest (envelope encryption with a key from env/KMS),
  never log them, never send them to the browser. Handle revoked/expired tokens by
  marking the integration as "needs reconnect" and emailing the admin.
- Follow Google's API Services User Data Policy; the privacy policy page must state
  exactly what we read and why. Note in the README what Google OAuth verification
  this app will need before launch.
- Design the integrations table and sync code so Google Workspace directory sync,
  Microsoft 365/Entra sync, contacts export and SCIM can be added later as new
  providers without schema changes.

## MVP features
1. Auth + onboarding: sign up, create org, set branding (logo upload, colours).
2. Admin dashboard: list/add/edit/archive staff cards; CSV import with a preview and
   per-row errors; bulk download of QR codes (PNG/SVG, zipped).
3. Public card page at /c/{randomId} (and optional /{orgSlug}/{cardSlug} on paid plans):
   server-rendered, cached, mobile-first, rendered from the card's design JSON,
   Save contact (.vcf), QR dialog (vCard or link), "Chat on WhatsApp" (pre-filled message),
   Add to Google Wallet, noindex. Works without JavaScript for the basic details.
4. Themes + brand lock, as described in "Card design system".
5. "Company owns the QR": when a card is archived, the admin picks a redirect
   (another card or the company page); the old URL and printed QR keep working.
6. Lead capture: "Share your details back" form on the card with explicit PDPA consent;
   leads visible to the card owner and admins; CSV export.
7. Google Wallet: one issuer (PyraHash), one Generic class per org, one object per card;
   create on card creation, PATCH on edit, mark inactive on archive. Retries + error log.
8. Analytics: per-card and per-org counts of views, contact saves, WhatsApp clicks,
   QR opens, last 30 days.
9. Billing: Free (1 card), Team (per seat). Enforce seat limits; Stripe webhooks keep
   subscriptions in sync; Customer Portal for invoices.

## Security and compliance (must-haves)
- RLS on every table; a test proving org A can never read org B's data.
- Random, unguessable public card IDs; rate limiting on public pages and lead form.
- Secrets only in environment variables / Vercel secrets; never in code or the DB.
- Escape/validate all user content; only http(s), tel:, mailto:, wa.me links allowed.
- No user-supplied HTML/CSS/JS anywhere; designs are schema-validated JSON only.
- Malaysia PDPA: consent capture on leads, data export and delete per person and per org,
  audit log of admin changes. Store data in a Singapore region where possible.

## Out of scope for this MVP (do not build yet)
Google Workspace directory sync, Microsoft 365/Entra sync, Google/Outlook contacts
export, calendar booking, SCIM, Workspace Marketplace listing,
structured design editor (layout, fonts, backgrounds, section order), AI design
assistant, Apple Wallet, NFC hardware, event mode, CRM integrations, SSO/directory sync,
custom customer domains, bilingual auto-switch.
Later the AI design assistant will turn a text prompt or logo into a `CardDesign` JSON
(never HTML), validated by the same schema and checks, shown as a preview. Keep the
design schema and renderer clean enough for that.

## How to work
1. First, ask me any questions that block you, then propose: folder structure,
   schema + RLS policies, the CardDesign schema, and a milestone plan. Wait for my OK.
2. Build in milestones, each ending with passing tests, a short demo checklist, and a commit:
   M1 auth/orgs/branding · M2 cards CRUD + public card page (Neon theme) ·
   M3 themes + brand lock · M4 CSV + Google Sheets import (Picker) + QR export · M5 redirect-on-archive + leads ·
   M6 Google Wallet · M7 analytics · M8 Stripe billing.
3. Keep a README with local setup, env vars, and deploy steps. Seed script with demo data.
4. Verify Google Wallet and Stripe API details against their current official docs;
   note any assumption in the README instead of guessing field names.
5. Do not mark a milestone done until its tests pass; report failures honestly.

## Inputs I'll provide
- Product name / domain: [e.g. pyrahash.app]
- Google Wallet issuer ID + service account (via env vars, later)
- Stripe test keys (via env vars, later)
- Google Cloud OAuth client ID/secret + Picker API key (via env vars, later)
- Pricing: Team plan = [RM __ per seat / month]
````
