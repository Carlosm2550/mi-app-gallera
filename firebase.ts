import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBjIk1hh33Covkjrko6g-geVHSnDv9vMxw",
  authDomain: "softgallos-17d4d.firebaseapp.com",
  projectId: "softgallos-17d4d",
  storageBucket: "softgallos-17d4d.firebasestorage.app",
  messagingSenderId: "777958904746",
  appId: "1:777958904746:web:8956cb5085e661105791d3",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export the services we will use throughout the app
export const auth = getAuth(app);
export const db = getFirestore(app);
export { firebaseConfig }; // Export config for temporary app instances
