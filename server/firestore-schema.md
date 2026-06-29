# Firestore Schema — Phase 1

Purpose
- Define collections and fields for Phase 1: authentication, uploads, topic mapping, and the "First-10" duplication detection logic.
- Provide guidance for indexes and the transactional flow to implement the First-10 counter.

Collections

1) users (collection)
- doc id: <uid> (Firebase Auth uid)
- fields:
  - email: string
  - displayName: string
  - photoURL?: string
  - roles: map { admin: boolean, moderator: boolean }
  - createdAt: timestamp
  - lastSeen: timestamp

Example document:
{
  email: "student@example.com",
  displayName: "Jane Student",
  roles: { admin: false, moderator: false },
  createdAt: <timestamp>,
  lastSeen: <timestamp>
}

2) uploads (collection)
- doc id: auto-generated uploadId
- fields:
  - ownerUid: string (ref to users/<uid>)
  - filename: string
  - storagePath: string (gs:// or storage path)
  - uploadedAt: timestamp
  - textContent: string (OCR/text extraction)
  - snippetFirst10: string (normalized first 10 tokens/chars used for duplication check)
  - snippetFirst10Hash: string (hash of snippetFirst10)
  - first10FingerprintVersion: int (schema versioning for fingerprinting)
  - first10Count: number (optional materialized count — mirrors first10_snippets/<hash>.count)
  - topics: array of topicIds
  - status: string (pending, verified, flagged)
  - verifiedBy: string|null (uid or "ai")

Example document:
{
  ownerUid: "uid_abc",
  filename: "paper1.pdf",
  storagePath: "uploads/uid_abc/paper1.pdf",
  uploadedAt: <timestamp>,
  textContent: "Full OCRed text...",
  snippetFirst10: "the quick brown fox jumps over the",
  snippetFirst10Hash: "sha256:...",
  first10FingerprintVersion: 1,
  first10Count: 1,
  topics: ["topic_math_quadratics"],
  status: "pending",
  verifiedBy: null
}

3) topics (collection)
- doc id: topic_<slug>
- fields:
  - name: string
  - keywords: array<string>
  - syllabusRefs?: array<string>  # optional mapping to docs or units
  - createdAt: timestamp

Example:
{
  name: "Quadratics",
  keywords: ["quadratic", "parabola", "roots", "discriminant"],
  createdAt: <timestamp>
}

4) first10_snippets (collection)
- doc id: <snippetHash> (e.g., sha256 of normalized first-10 snippet)
- fields:
  - snippet: string (normalized first 10 tokens or chars)
  - hash: string (same as doc id)
  - count: number (how many uploads reference this snippet)
  - uploadIds: array<string> (OPTIONAL: capped list of uploadIds referencing this snippet — consider subcollection if many)
  - firstSeenAt: timestamp
  - lastSeenAt: timestamp

Purpose & Flow for First-10 Duplication Logic

- When a file is uploaded and OCR/text is available, compute the normalized "first-10" snippet:
  - Normalize: trim, lowercase, remove punctuation, collapse whitespace.
  - Tokenization: choose either first 10 words or first N characters (pick one and set `first10FingerprintVersion` accordingly).
  - Compute sha256 hash of the normalized snippet -> snippetHash.

- Transactional update (Firestore transaction recommended):
  1. Write uploads/<uploadId> with its fields, including snippetFirst10Hash.
  2. Read first10_snippets/<snippetHash>.
     - If exists: increment `count` and optionally push uploadId to `uploadIds` (watch array size limits).
     - If not exists: create doc with count = 1 and uploadIds = [uploadId].
  3. Optionally update uploads/<uploadId>.first10Count to reflect the new count.

- Implement this logic inside a Cloud Function (server-side) to prevent client-side tampering; use a service account or privileged callable function.

Indexes (recommended)
- uploads: composite index on (ownerUid, uploadedAt desc)
- uploads: index on snippetFirst10Hash
- first10_snippets: index on count (desc) to find most-common snippets
- topics: keywords array should be searchable via client-side filtering or via Algolia/Elastic if needed for full-text

Security & Access Patterns
- Writes to first10_snippets should be done by trusted server code (Cloud Functions) or require an admin claim on the user token. Avoid allowing arbitrary clients to increment counts directly.
- uploads should be writable by authenticated users for creation, but only the owner (or admins) can modify/delete their upload entries. Topic assignment and `verifiedBy` should be restricted to server-side logic (Cloud Functions) or moderator roles.

Data-retention & scaling notes
- uploadIds array in first10_snippets will grow; prefer a capped array or a `occurrences` subcollection containing { uploadId, ownerUid, seenAt } documents when you expect high cardinality.
- For analytics, export first10_snippets periodically to BigQuery for aggregation.

Implementation pointers
- Use Cloud Functions (Node.js or TypeScript) to implement the transactional logic. Example pseudo-code available on request.
- Provide a migration path by bumping `first10FingerprintVersion` when you change normalization/tokenization rules. This allows re-indexing old uploads if needed.


