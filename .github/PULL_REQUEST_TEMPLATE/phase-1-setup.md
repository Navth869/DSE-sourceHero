# PR: Phase 1 — Firestore rules, Cloud Function, Tests, Client Integration & CI

## Summary

- Implements Phase 1 infrastructure and security for UniBound:
  - Adds Firestore security rules to prevent client tampering of institution counters and award fields.
  - Adds a server-side callable Cloud Function `submitAndVerify` that centralizes registration, First‑10 transaction logic, submission creation, and server-side AI grading.
  - Adds a Vitest integration test that validates the First‑10 behavior using the Firestore emulator.
  - Refactors the client registration flow to call the Cloud Function (`httpsCallable`) and introduces a loading state.
  - Adds a GitHub Actions CI workflow to run tests and build on the `phase-1-setup` branch.

## Files of interest
- `firestore.rules`
- `server/functions/src/index.ts` (submitAndVerify callable Cloud Function)
- `server/functions/__tests__/first10.test.ts` (Vitest integration test)
- `client/src/unibound_production_engine.tsx` (refactored registration UI to call Cloud Function, loading state)
- `.github/workflows/ci.yml` (CI: tests & build for phase-1-setup)

## Motivation

- Move all sensitive business logic (institution counters, awarding points, AI grading) server-side to prevent client-side tampering.
- Make First‑10 logic deterministic and testable with the Firestore emulator.
- Protect Gemini/API keys by keeping AI calls in Cloud Functions.
- Provide a clear developer workflow and CI to validate the Phase‑1 contract.

## How to review

1. Security rules
   - Inspect `firestore.rules` for allowed/denied write/read patterns. Confirm it fits your policy for institutions/submissions/users.
2. Cloud Function
   - Review `server/functions/src/index.ts` for correct auth checks, error handling, and calls to shared helpers.
   - Ensure imports can be resolved by the functions build (see "Integration notes" below).
3. Tests
   - Inspect `server/functions/__tests__/first10.test.ts` — it uses the Firestore emulator to validate the first-10 behavior and submission_count increments.
4. Client
   - Check `client/src/unibound_production_engine.tsx` for proper `httpsCallable` usage, loading state, and user feedback.
5. CI workflow
   - Ensure `.github/workflows/ci.yml` aligns with your repo layout and desired CI behavior.

## Local testing instructions

1. Checkout the branch:
   ```bash
   git fetch origin
   git checkout phase-1-setup
   ```

2. Start Firestore emulator:
   ```bash
   firebase emulators:start --only firestore
   ```

3. Run server tests (Vitest):
   ```bash
   cd server
   npx vitest
   ```

4. Run client locally:
   ```bash
   cd client
   npm install
   npm run dev
   ```

## Manual QA flow

- Sign in as a test user (emulator or Auth), open the client UI, register an institution via the modal.
- Confirm Cloud Function is invoked (via logs) and submission doc is created in Firestore.
- Confirm `institution.submission_count` increments and first-10 behavior matches expected results.

## Integration notes & known limitations

- Shared helpers (`src/lib/firebase_backend_engine.ts` and `src/lib/gemini_grader.ts`) are imported from the top-level `src` in the Cloud Function. In many Firebase Functions setups you must either:
  - copy shared libs into `server/functions/src/lib` and import them relatively, or
  - configure a build step (tsc/webpack/rollup) that bundles shared code into the functions package.
  Please confirm your build pipeline handles this, otherwise adjust location/imports before deploying.

- Keep all Gemini API keys and Firebase service account JSON server-side (functions env or GitHub secrets). Do not expose `VITE_GEMINI_API_KEY` in production.

- The CI workflow starts the Firestore emulator on port 8080. Ensure port availability and that the workflow's environment installs firebase-tools as shown.

## Secrets & deployment

- Add the following repo secrets in GitHub (Settings → Secrets):
  - `FIREBASE_SERVICE_ACCOUNT` (JSON) — for deployments
  - `GEMINI_API_KEY` (if needed server-side)

- To deploy functions locally for further integration:
  ```bash
  firebase deploy --only functions --project <your-project-id>
  ```

- For hosting + functions deploy, ensure CI/Actions has `FIREBASE_SERVICE_ACCOUNT` secret set.

## Suggested reviewers
- Backend maintainers (Cloud Functions / Firestore)
- Security reviewer (rules)
- Frontend maintainer (client changes)

## Merge strategy
- Squash and merge is recommended to keep history tidy and to ensure the README/commit messages are consolidated.

## PR checklist (suggested)
- [ ] Firestore rules validated by security reviewer
- [ ] Shared helper imports resolved for functions build
- [ ] Secrets added to repo (FIREBASE_SERVICE_ACCOUNT, GEMINI_API_KEY)
- [ ] Emulator tests pass locally (Vitest)
- [ ] Manual QA of client -> Cloud Function flow
- [ ] CI workflow passes in branch

