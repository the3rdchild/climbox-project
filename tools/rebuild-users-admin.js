// tools/rebuild-users-admin.js
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const keyPath = path.resolve(__dirname, "acc.json");
if (!fs.existsSync(keyPath)) {
  console.error("Missing service account JSON. Place it at:", keyPath);
  console.error("Download from Firebase Console → Project Settings → Service accounts → Generate new private key");
  process.exit(1);
}
const serviceAccount = require(keyPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const SAMPLE_USERS = [
  {
    uid: "uid_demo_1",
    authEmail: "alice@example.com",
    displayName: "Alice",
    contacts: { emails: ["alice@example.com"], phones: ["+628111000111"] },
    notificationLocations: ["pulau_komodo"],
  },
  {
    uid: "uid_demo_2",
    authEmail: "bob@example.com",
    displayName: "Bob",
    contacts: { emails: ["bob@example.com"], phones: ["+628222000222"] },
    notificationLocations: ["pulau_komodo", "pulau_2"],
  },
  {
    uid: "uid_demo_3",
    authEmail: "charlie@example.com",
    displayName: "Charlie",
    contacts: { emails: ["charlie@example.com"], phones: [] },
    notificationLocations: []
  }
];

async function deleteCollection(collPath, batchSize = 500) {
  const collRef = db.collection(collPath);
  const snapshot = await collRef.limit(batchSize).get();
  if (snapshot.size === 0) return;
  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  if (snapshot.size === batchSize) {
    return deleteCollection(collPath, batchSize);
  }
}

async function main() {
  console.log("Deleting userIndex and users (if any)...");
  await deleteCollection("userIndex");
  await deleteCollection("users");
  console.log("Creating sample users...");
  const batch = db.batch();
  SAMPLE_USERS.forEach(u => {
    const uref = db.collection("users").doc(u.uid);
    batch.set(uref, {
      authEmail: u.authEmail,
      displayName: u.displayName,
      contacts: u.contacts,
      notificationLocations: u.notificationLocations,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    const nameKey = `displayName_${u.displayName.toLowerCase()}`;
    const nref = db.collection("userIndex").doc(nameKey);
    batch.set(nref, { uid: u.uid, authEmail: u.authEmail, type: "displayName" });
    if (u.contacts && u.contacts.phones && u.contacts.phones.length) {
      const pkey = `phone_${u.contacts.phones[0].replace(/[^+\\d]/g,"")}`;
      const pref = db.collection("userIndex").doc(pkey);
      batch.set(pref, { uid: u.uid, authEmail: u.authEmail, type: "phone" });
    }
  });
  await batch.commit();
  console.log("Done.");
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
