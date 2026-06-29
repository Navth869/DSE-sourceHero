# UniBound — DSE Accelerator

UniBound is a hybrid full‑stack monorepo that helps DSE candidates verify and gamify their syllabus study materials. It combines a React frontend (Vite + Tailwind) with secure Firebase backend logic and an AI grading/verification engine (Gemini + PDF parsing).

Status: Phase 1 — Database architecture, secure First‑10 logic, submission flow.

## Table of Contents
- Project Overview
- Roadmap / Phases
- Tech Stack
- Repo layout
- Environment variables
- Local development (client & server)
- Firestore schema (Phase 1)
- Security & Rules (recommendation)
- CI / CD (Firebase Hosting)
- How the First‑10 flow works
- AI grading (Phase 2 — prompt template)
- Contribution
- License

---

## Project Overview
UniBound provides:
- Secure submission tracking with institution-aware "First‑10" rules.
- AI-powered grading and syllabus verification for uploaded PDFs.
- Gamified points and verification hierarchy for students and moderators.

Purpose of Phase 1
- Implement Firestore schema and server-side transactions to prevent client tampering.
- Provide a reproducible grading prompt interface (Gemini) for Phase 2.
- Create secure Cloud Function wrapper endpoints that the client calls.

---

## Roadmap / Phases
- Phase 1 — Database architecture & secure submission flow (current)
- Phase 2 — AI syllabus verification (Gemini) + PDF parsing (PyMuPDF)
- Phase 3 — UI polish, calendar/forum, gamification and marketplace

---

## Tech Stack
- Frontend: React + Vite, TypeScript, Tailwind CSS
- Backend: Firebase (Firestore, Auth, Cloud Functions)
- AI: Google Gemini (via server wrapper)
- PDF parsing: PyMuPDF (server-side) or the chosen PDF parsing tool
- CI: GitHub Actions
- Hosting: Firebase Hosting / Cloud Functions

---

## Repository Layout
unibound/
- .github/workflows/        # CI/CD
- client/                   # Vite + React frontend
- server/                   # Firebase Cloud Functions, PyMuPDF scripts
- src/lib/                  # shared helpers (firebase_backend_engine.ts, gemini_grader.ts)
- docs/                     # design docs, syllabi mapping, keywords
- README.md
- .gitignore

Files added in Phase 1 (draft)
- src/lib/firebase_backend_engine.ts — First‑10 transaction helpers
- src/lib/gemini_grader.ts — AI prompt wrapper & safe parser
- server/firestore-schema.md — Phase‑1 schema docs

---

## Environment Variables (example)
Add these to .env.local (do NOT commit .env files — they are in .gitignore)

Client (Vite)
- VITE_FIREBASE_API_KEY=...
- VITE_FIREBASE_AUTH_DOMAIN=...
- VITE_FIREBASE_PROJECT_ID=...
- VITE_GEMINI_API_KEY=...  (see security note below)

Server (Cloud Functions / Admin)
- FIREBASE_SERVICE_ACCOUNT (JSON as secret)
- GEMINI_API_KEY (server-side)
- NODE_ENV=development

GitHub repository secrets (for Actions)
- FIREBASE_SERVICE_ACCOUNT (JSON)
- GEMINI_API_KEY (if used server-side)

Security note: Handle VITE_GEMINI_API_KEY with extreme care. If you must include AI keys in the client during development, ensure they are short-lived and strictly limited in scope. For production, never expose Gemini (or any AI) API keys in the browser—route all AI calls through server-side Cloud Functions or a secure backend so the key remains secret and usage can be audited.

---

## Local Development

Prereqs:
- Node.js 18+
- Firebase CLI (for emulator and deploy)
- Optional: Python + pip (for PyMuPDF tasks)

1. Clone & install
```bash
git clone https://github.com/<your-org>/DSE-sourceHero.git
cd DSE-sourceHero
# client
cd client
npm install
# server
cd ../server
npm install
```

2. Run dev frontend
```bash
cd client
npm run dev
```

3. Run functions locally (emulator)
```bash
# from repo root
firebase emulators:start --only functions,firestore,auth,hosting
```

4. Running tests
- Unit tests for helpers (jest / vitest) — (add test scripts to package.json)

---

## Firestore Schema (Phase 1) — overview

Collections:
- institutions (doc id: institution_slug)
  - name: string
  - submission_count: number
  - is_eligible_for_first_ten: boolean
  - createdAt: timestamp

- users (doc id: uid)
  - email, displayName, institution_id, total_points, roles, createdAt

- submissions (doc id: auto)
  - ownerUid, institutionId, filename, storagePath, textContent (OCR), grade_submitted, status (pending/verified/flagged), firstTenAwarded, createdAt, updatedAt, meta

- first10_snippets (optional for duplicate detection)
  - snippetHash, snippet, count, occurrences (subcollection)

See server/firestore-schema.md for full details and transaction flow.

---

## First‑10 Flow (how it works)
1. Client uploads PDF to Storage and sends OCR/text + metadata to a secure backend endpoint.
2. Backend calls registerSchoolAndAllocatePoints(schoolName, userUid) inside a Firestore transaction:
   - Creates institution doc if missing and sets submission_count = 1
   - Otherwise increments submission_count
   - Determines whether this submission is within the first N (default 10) and awards points
3. Backend creates submissions/<id> atomically in same transaction (or in a follow-up secure operation)
4. Client receives result and displays “First‑10 awarded” if applicable

This ensures clients cannot spoof submission_count or award points.

---

## Security & Firestore Rules (recommended)
- institutions: read allowed; write/update restricted to admin/service account
- submissions: allow create if authenticated and ownerUid == request.auth.uid; prevent client updates to award fields
- users: allow read for authenticated users; update total_points only via server/admin

Example (conceptual snippet):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /institutions/{id} {
      allow read: if true;
      allow write: if request.auth.token.admin == true;
    }
    match /submissions/{id} {
      allow create: if request.auth != null && request.resource.data.ownerUid == request.auth.uid;
      allow update: if request.auth.token.admin == true;
    }
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

---

## CI / CD (GitHub Actions -> Firebase Hosting + Functions)
Example workflow (add to .github/workflows/firebase-hosting-merge.yml):

```yaml
name: Deploy to Firebase Hosting
on:
  push:
    branches:
      - main
jobs:
  build_and_deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build client
        run: cd client && npm install && npm run build
      - name: Deploy to Firebase
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: '${{ secrets.GITHUB_TOKEN }}'
          firebaseServiceAccount: '${{ secrets.FIREBASE_SERVICE_ACCOUNT }}'
          projectId: unibound-production
```

Note: Actions require repository secrets to be configured in Settings → Secrets & variables.

---

## AI Grading — Phase 2 (prompt & wrapper summary)
- src/lib/gemini_grader.ts contains a prompt template that:
  - Injects syllabus topic and rubric
  - Requires the model to return only valid JSON: {score, feedback, isVerified, confidence}
  - Includes a server-side wrapper that validates/normalizes the model output before writing to Firestore
- Keep Gemini API calls server-side to protect keys and control prompts.

Parsing & fallback
- Always validate JSON shape; on parse failure, log, store for human review, and mark submission.status = 'flagged' or 'pending_review'.

---

## How to integrate UI (example)
- Replace any direct runTransaction usage in UI with a call to a secure endpoint (Cloud Function).
- Example flow:
  - Client calls POST /api/submit with storagePath, schoolName, ocrText
  - Backend authenticates, calls registerSchoolAndAllocatePoints, grades (optional), stores submission doc, and returns result

---

## Contribution & Development Notes
- Branching: keep main stable. Use feature branches for phases:
  - phase-1-setup
  - phase-2-verification
  - phase-3-ui
- Linting & formatting: add ESLint, Prettier rules (recommended)
- Tests: add unit tests for:
  - normalization logic
  - transaction logic with Firestore emulator
  - AI prompt parser with sample responses

---

## Troubleshooting & Known Gotchas
- Firestore increment() must be used inside transactions to ensure atomicity.
- Avoid client-side updates to institution counters — must be server-controlled.
- Ensure GitHub Actions secrets are correctly populated for deploy workflow.

---

## License
MIT (or choose another license)

---

If you want any of the following included or adjusted before I commit, tell me which:
- More detailed CI workflows (deploy functions + hosting + emulator tests)
- Full example Cloud Function (TypeScript) that wraps registerSchoolAndAllocatePoints and the grader
- Example client .tsx changes (I can paste a ready-to-use diff)
- Custom rubric and sample gemini prompt tuned for a specific syllabus topic

Reply "Committed" to confirm or tell me edits and I will update the file.