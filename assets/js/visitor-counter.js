/* =====================================================
   Firebase – Global Visitor Counter
   Project: fhz545-teachers
   Starts from: 783
   ===================================================== */

(async () => {
const { initializeApp } = await import("https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js");
const { getFirestore, doc, runTransaction, onSnapshot } = await import("https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js");

/* Firebase configuration */
const firebaseConfig = {
  apiKey: "AIzaSyD6ewzxqeXlpueL5KZ51HiZgrf6pBrAyXY",
  authDomain: "fhz545-teachers.firebaseapp.com",
  projectId: "fhz545-teachers",
  storageBucket: "fhz545-teachers.firebasestorage.app",
  messagingSenderId: "475715515720",
  appId: "1:475715515720:web:9b0d894433fe8500566f7d"
};

/* Initialize Firebase */
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

/* Reference to counter document */
const counterRef = doc(db, "site", "counter");

/* UI element */
const counterEl = document.getElementById("visitorCount");

/* Prevent double counting on refresh */
const SESSION_KEY = "FH_VISITOR_COUNTED";
/* Live update for all visitors (display) */
onSnapshot(counterRef, (snap) => {
  const visits = snap.exists() ? (snap.data().visits ?? 783) : 783;
  if (counterEl) counterEl.textContent = Number(visits).toLocaleString("ar-SA");
});

/* Increment counter once per visitor session (tab session) */
async function incrementVisitor() {

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists() ? (snap.data().visits ?? 783) : 783;
      tx.set(counterRef, { visits: current + 1 }, { merge: true }); // ينشئ الوثيقة إن لم تكن موجودة
    });

  } catch (e) {
    console.warn("Visitor counter error:", e);
  }
}

incrementVisitor();
})();
