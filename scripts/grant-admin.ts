// Give an account the `admin` claim, which is what lets it sign in to edit (firestore.rules).
//
//   npm run grant-admin -- someone@example.org                       (emulator)
//   FIREBASE_PROJECT_ID=… npx tsx scripts/grant-admin.ts someone@example.org --live
//
// On the emulator it also creates the account if it is missing, with the password from
// --password or LOCAL_ADMIN_PASSWORD. On a real project accounts are made in the Firebase
// console first; this script never creates one there.

import { admin_auth, use_emulator } from "../lib/firebase-admin";

async function main() {
  const email = process.argv.slice(2).find((a) => !a.startsWith("--"))?.trim().toLowerCase();
  if (!email) throw new Error("Usage: npm run grant-admin -- <email> [--password <password>]");
  const onEmulator = !process.argv.includes("--live");
  if (onEmulator) use_emulator();
  const auth = admin_auth();

  let user = await auth.getUserByEmail(email).catch(() => null);
  if (!user) {
    if (!onEmulator) throw new Error(`${email} has no account. Create it in the Firebase console, then run this again.`);
    const i = process.argv.indexOf("--password");
    const password = i > 0 ? process.argv[i + 1] : process.env.LOCAL_ADMIN_PASSWORD;
    if (!password) throw new Error("No --password given and LOCAL_ADMIN_PASSWORD is not set.");
    user = await auth.createUser({ email, password, emailVerified: true });
    console.log(`created ${email} on the emulator`);
  }
  await auth.setCustomUserClaims(user.uid, { ...user.customClaims, admin: true });
  console.log(`${email} is an admin. They need to sign in again for it to take effect.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
