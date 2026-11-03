// The browser's Firebase app: Auth and Firestore, pointed at the emulator when asked.

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

let cached: { app: FirebaseApp; auth: Auth; db: Firestore } | null = null;

export function firebase(): { app: FirebaseApp; auth: Auth; db: Firestore } {
  if (cached) return cached;
  const emulators = process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "1";
  const app = getApps()[0] ?? initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (emulators) {
    // Ports from firebase.json.
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  cached = { app, auth, db };
  return cached;
}
