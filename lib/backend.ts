// Which database and sign-in the app runs on. Read on both sides, so it is a public env var.
//   csv       data/*.csv through app/api/rows, one local admin from .env.local (the trial)
//   firebase  Firestore rows and Firebase Auth; the emulator when NEXT_PUBLIC_FIREBASE_EMULATORS=1
export type Backend = "csv" | "firebase";

export const BACKEND: Backend = process.env.NEXT_PUBLIC_BACKEND === "firebase" ? "firebase" : "csv";
