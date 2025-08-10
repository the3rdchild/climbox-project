// /services/auth.js
import { getAuth, signInWithPhoneNumber } from "firebase/auth";
import { app } from "./firestore"; // reuse initialized app

const auth = getAuth(app);

export { auth, signInWithPhoneNumber };
