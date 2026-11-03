// Server-only. The Admin SDK, for verifying ID tokens in route handlers and for the scripts.
// Against the emulator it needs only the project id (FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST set);
// against a real project, GOOGLE_APPLICATION_CREDENTIALS names a service-account key file.

import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function app() {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID is not set");
  const onEmulator = !!(process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST);
  return getApps()[0] ?? initializeApp(onEmulator ? { projectId } : { projectId, credential: applicationDefault() });
}

export const admin_auth = () => getAuth(app());
export const admin_db = () => getFirestore(app());

// The scripts' default: the local emulator from firebase.json, project demo-cartography (a demo-
// project id can never reach a real one). Must run before the first admin_* call.
export function use_emulator() {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
  process.env.FIREBASE_PROJECT_ID ??= "demo-cartography";
}
