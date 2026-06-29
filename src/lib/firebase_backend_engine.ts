// src/lib/firebase_backend_engine.ts
import { doc, runTransaction, increment, getFirestore } from 'firebase/firestore';

const db = getFirestore();

/**
 * Handles the "First-10" registration logic and institutional point allocation.
 * This transaction ensures that we never exceed the quota for specific tier rewards.
 */
export async function registerSchoolAndAllocatePoints(schoolName: string, userId: string) {
  const schoolRef = doc(db, 'institutions', schoolName.toLowerCase().replace(/\s+/g, '_'));
  
  try {
    await runTransaction(db, async (transaction) => {
      const schoolDoc = await transaction.get(schoolRef);
      
      if (!schoolDoc.exists()) {
        // Initialize new institution
        transaction.set(schoolRef, {
          name: schoolName,
          submission_count: 1,
          is_eligible_for_first_ten: true
        });
      } else {
        // Increment count and check First-10 threshold
        const count = schoolDoc.data().submission_count;
        transaction.update(schoolRef, {
          submission_count: increment(1),
          is_eligible_for_first_ten: count < 10
        });
      }
    });
    return { success: true };
  } catch (error) {
    console.error("Transaction failed: ", error);
    return { success: false, error };
  }
}
