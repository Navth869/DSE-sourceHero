import { Firestore, doc, runTransaction, Timestamp, increment } from 'firebase/firestore';

/**
 * Server-safe helper functions to handle Phase-1 Firestore transactions
 * that implement the "First-10" submission rule and user point assignment.
 *
 * This module is intended to be imported by your backend/cloud-functions
 * or by privileged client code (prefer using Cloud Functions with admin
 * credentials instead of client SDK in production).
 */

export type SubmissionPayload = {
  filename: string;
  storagePath: string; // e.g. gs://... or storage path
  textContent?: string; // OCR'd text (optional)
  gradeSubmitted?: string; // student's self-declared grade string
  meta?: Record<string, any>;
};

export type TransactionResult = {
  success: boolean;
  submissionId?: string;
  awardedPoints?: number;
  isFirstTen?: boolean;
  message?: string;
};

// Configuration / policy constants — adjust to your needs
const FIRST_TEN_THRESHOLD = 10; // first N submissions get priority
const FIRST_TEN_POINTS = 10; // points awarded to first-N submissions
const DEFAULT_SUBMISSION_STATUS = 'pending';

/**
 * submitPdfSubmission
 *
 * Atomically creates a submissions document, increments the institution's
 * submission_count and (optionally) increments the user's total_points
 * if the submission qualifies as one of the institution's "First-10".
 *
 * Parameters:
 * - db: initialized Firestore instance (pass getFirestore() or admin.firestore() wrapper)
 * - userUid: the submitting user's uid
 * - institutionId: id of the institution (string, doc id in institutions collection)
 * - payload: submission metadata
 * - options.allowAutoPointUpdate: if true, the transaction will update users/<uid>.total_points
 *
 * Returns TransactionResult describing outcomes.
 */
export async function submitPdfSubmission(
  db: Firestore,
  userUid: string,
  institutionId: string,
  payload: SubmissionPayload,
  options?: { allowAutoPointUpdate?: boolean }
): Promise<TransactionResult> {
  const allowAuto = options?.allowAutoPointUpdate ?? true;

  const institutionsRef = (id: string) => doc(db, 'institutions', id);
  const usersRef = (uid: string) => doc(db, 'users', uid);
  const submissionsRef = () => doc(db, 'submissions', undefined as any); // placeholder - created inside transaction

  try {
    const result = await runTransaction(db, async (tx) => {
      const instRef = institutionsRef(institutionId);
      const instSnap = await tx.get(instRef);

      if (!instSnap.exists()) {
        throw new Error(`Institution not found: ${institutionId}`);
      }

      const instData: any = instSnap.data();
      const currentCount: number = typeof instData.submission_count === 'number' ? instData.submission_count : 0;

      // Determine whether this submission is within the First-10
      const newCount = currentCount + 1;
      const isFirstTen = currentCount < FIRST_TEN_THRESHOLD;

      // Build the new submission doc
      const submissionsColRef = doc(db, 'submissions', '');
      // Firestore client doesn't allow creating a new doc id with doc(db, 'submissions') in TS easily,
      // so instead create an auto-id by using collection + doc from firebase/firestore in consumer code.
      // Here we'll compute an id using timestamp + random suffix to keep it deterministic in transaction.
      const generatedId = `s_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
      const submissionRef = doc(db, 'submissions', generatedId);

      const submissionDoc = {
        ownerUid: userUid,
        institutionId,
        filename: payload.filename,
        storagePath: payload.storagePath,
        textContent: payload.textContent ?? null,
        grade_submitted: payload.gradeSubmitted ?? null,
        status: DEFAULT_SUBMISSION_STATUS,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        firstTenAwarded: isFirstTen,
        firstTenVersion: 1,
        meta: payload.meta ?? {},
      } as any;

      // Write submission
      tx.set(submissionRef, submissionDoc);

      // Update institution submission_count
      tx.update(instRef, { submission_count: increment(1) });

      let awardedPoints = 0;
      if (isFirstTen) {
        awardedPoints = FIRST_TEN_POINTS;
        if (allowAuto) {
          const userRef = usersRef(userUid);
          // If user doc does not exist, create it with initial points using set with merge
          const userSnap = await tx.get(userRef);
          if (userSnap.exists()) {
            tx.update(userRef, { total_points: increment(awardedPoints) });
          } else {
            tx.set(userRef, {
              institution_id: institutionId,
              total_points: awardedPoints,
              createdAt: Timestamp.now(),
            });
          }
        }
      }

      return {
        success: true,
        submissionId: generatedId,
        awardedPoints,
        isFirstTen,
        message: isFirstTen ? `Submission is within first ${FIRST_TEN_THRESHOLD}` : 'Submission accepted',
      } as TransactionResult;
    });

    return result;
  } catch (err: any) {
    return { success: false, message: err.message ?? String(err) };
  }
}

/**
 * getGeminiGradingPrompt
 *
 * Returns a standardized prompt that should be sent to the Gemini grading model
 * in Phase 2. The prompt asks the model to grade the PDF content according to
 * an expected rubric and to output JSON with a consistent shape.
 *
 * Example usage: const prompt = getGeminiGradingPrompt({ syllabusTopic: 'Quadratics', rubric: [...] });
 */
export function getGeminiGradingPrompt(options?: {
  syllabusTopic?: string;
  rubric?: Array<{ criterion: string; maxScore: number; guidance?: string }>;
  expectedOutputFields?: string[]; // default: ['score','breakdown','confidence','comments']
}) {
  const topic = options?.syllabusTopic ?? 'Unknown Topic';
  const rubric = options?.rubric ?? [
    { criterion: 'Accuracy of key steps', maxScore: 5 },
    { criterion: 'Correct final answer', maxScore: 3 },
    { criterion: 'Notation & presentation', maxScore: 2 },
  ];
  const outputFields = options?.expectedOutputFields ?? ['score', 'breakdown', 'confidence', 'comments'];

  const rubricText = rubric
    .map((r, i) => `${i + 1}. ${r.criterion} (max ${r.maxScore})${r.guidance ? ' — ' + r.guidance : ''}`)
    .join('\n');

  return `You are an unbiased, strict exam-grader AI. Grade the student's submitted PDF text for the syllabus topic: "${topic}".

Rubric (apply these criteria and return scores per criterion):\n${rubricText}

Instructions:
- Read the provided extracted text from the PDF and evaluate it against the rubric above.
- Provide a total numeric score and a JSON object with the following fields: ${outputFields.join(', ')}.
- "breakdown" must be an object mapping each rubric criterion to the numeric score awarded and a short explanation.
- "confidence" should be a 0-100 integer representing grading confidence.
- "comments" should be a short human-readable paragraph summarizing strengths and issues.

Output ONLY valid JSON. Example output shape:
{
  "score": 8,
  "breakdown": { "Accuracy of key steps": { "score": 4, "explanation": "Most steps correct" }, "Correct final answer": { "score": 3, "explanation": "Final answer correct" }, "Notation & presentation": { "score": 1, "explanation": "Minor notation errors" } },
  "confidence": 92,
  "comments": "Good solution; minor notation issues."
}

End of prompt.`;
}

