import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "YOUR_KEY",
  authDomain: "YOUR_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_BUCKET",
  messagingSenderId: "YOUR_MSG_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// ---- Sensor Data ----
export async function getSensorData(locationId, startDate, endDate) {
  const dataRef = collection(db, "sensorData");
  const q = query(
    dataRef,
    where("locationId", "==", locationId),
    where("timestamp", ">=", startDate),
    where("timestamp", "<=", endDate),
    orderBy("timestamp", "desc"),
    limit(500) // prevent loading too much
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function addSensorData(data) {
  return await addDoc(collection(db, "sensorData"), {
    ...data,
    timestamp: new Date()
  });
}

// ---- Notifications ----
export async function getNotifications() {
  const notifRef = collection(db, "notifications");
  const q = query(notifRef, orderBy("timestamp", "desc"), limit(50));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ---- User Profile ----
export async function getUserProfile(uid) {
  const docRef = doc(db, "users", uid);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return docSnap.data();
  } else {
    return null;
  }
}

export async function updateUserProfile(uid, profileData) {
  const docRef = doc(db, "users", uid);
  return await setDoc(docRef, profileData, { merge: true });
}