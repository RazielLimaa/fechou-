# Security Review - 2026-04-16

## Status

- Backend reviewed with focus on public routes, preview pipeline, signing, checkout, ratings and recent preview changes.
- Security hardening applied in code.
- `npm run build` passed.
- `npm run test:security` passed.

## Main fixes applied

### 1. Public preview now uses safer cache policy

Files:
- `src/routes/contracts.routes.ts`
- `src/routes/proposals.routes.ts`

Changes:
- Public preview-document responses now use `Cache-Control: no-store, max-age=0`.
- Added `Vary: Origin`.
- Kept `ETag`, `nosniff`, CSP and robots restrictions.

Why:
- Public share-token content should not remain in intermediary caches.
- This reduces accidental persistence of signed contract previews and token-derived documents.

### 2. Public preview reuses official renderer without leaking private preview assets

File:
- `src/services/contracts/contract-render.service.ts`

Changes:
- Added `publicPreview` mode to the official render pipeline.
- Split preview cache keys by access mode: `private` vs `public`.
- Public preview embeds signature images as inline data URLs instead of authenticated editor-only asset URLs.

Why:
- Prevents cross-context leakage between authenticated editor preview and public preview.
- Keeps one source of truth for layout, clause order, hidden clauses, custom content and branding.

### 3. Legacy public contract JSON no longer exposes hidden/raw clause state

File:
- `src/routes/contracts.routes.ts`

Changes:
- Public legacy route now returns clause data from the official rendered preview only.
- Removed raw clause exposure with `customContent` and hidden preview state.
- Public `layoutConfig` is sanitized before returning.

Why:
- Hidden clauses should not be recoverable from fallback JSON if the official preview hides them.
- This closes a data exposure path where preview-hidden content could still be inspected from the API response.

### 4. Sensitive public GET no longer decrypts signatures unnecessarily

File:
- `src/routes/contracts.routes.ts`

Changes:
- Removed unused signature decryption work from the legacy public contract GET route.

Why:
- Reduces attack surface and CPU cost on public endpoints.
- Avoids handling protected signature material when it is not needed for the response.

### 5. Public rating lookup is no longer enumerable by numeric contract ID alone

File:
- `src/routes/rating.routes.ts`

Changes:
- `GET /api/ratings/contract/:proposalId` now requires a valid `publicToken`.
- Added public read rate limiting for this lookup.
- Validates token hash and token expiration before returning rating data.

Why:
- Prevents enumeration of ratings by sequential contract ID.
- Makes rating visibility consistent with the public share-token security model.

### 6. Public payment checkout now has local and distributed throttling

File:
- `src/routes/payments.routes.ts`

Changes:
- Added a local `express-rate-limit` layer to `/api/payments/public/:token/checkout`.
- Kept the distributed limiter.

Why:
- If the distributed limiter degrades or fails open, the route still has a local fallback control.
- This protects checkout initialization without making the window aggressive for normal users.

### 7. Request sanitization no longer skips public signing routes

File:
- `src/middleware/security.ts`

Changes:
- Added `signatureDataUrl` to allowed raw data URL fields.
- Removed the old blanket bypass for `/public/.../sign`.
- Preserved raw `signerName` and `signerDocument` for strict schema validation instead of silently mutating them first.

Why:
- Keeps body sanitization active on public signing routes.
- Prevents accidental weakening where malicious fields were normalized into acceptable values before validation.

## Routes reviewed with highest priority

### Public contract and proposal access
- `GET /api/proposals/public/:token`
- `GET /api/proposals/public/:token/preview-document`
- `POST /api/proposals/public/:token/sign`
- `GET /api/contracts/review/:token`
- `GET /api/contracts/review/:token/preview-document`
- `GET /api/contracts/:token`
- `GET /api/contracts/:token/preview-document`

### Public payment and rating flows
- `POST /api/payments/public/:token/checkout`
- `POST /api/ratings`
- `GET /api/ratings/contract/:proposalId`

### Authenticated preview and rendering
- `POST /api/contracts/render`
- `GET /api/contracts/:id/preview-document`
- signature preview helpers and render cache behavior

## Security outcomes

Resolved:
- public preview cache persistence risk reduced
- authenticated/private preview asset reuse separated from public preview
- hidden clauses no longer leak through public legacy JSON
- unnecessary public signature decryption removed
- rating enumeration by contract ID closed
- public checkout gained fallback limiter
- public sign payload sanitization restored without breaking signature uploads

## Remaining items

No known critical backend security flaw remains from this review pass.

Operational recommendations still worth keeping:
- maintain token entropy at 64-hex share tokens
- rotate secrets and encryption keys with change control
- keep monitoring on public routes for abuse patterns
- add alerting for repeated invalid token scans and repeated public sign failures
- run this same security suite on CI before deploy

These are operational hardening steps, not open code vulnerabilities found in this pass.
