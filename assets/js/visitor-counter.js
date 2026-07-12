/* =====================================================
   Firebase – Global Visitor Counter
   Project: fhz545-teachers
   Starts from: 783
   ===================================================== */

(async () => {
  const FALLBACK_VISITS = 783;
  const SESSION_KEY = 'FH_VISITOR_COUNTED';
  const counterEl = document.getElementById('visitorCount');
  let incrementAttempted = false;

  // لا توجد حاجة لاتصال Firebase أو كتابة زيارة إذا لم يكن العداد معروضًا في الصفحة.
  if(!counterEl) return;

  function renderVisits(value){
    if(counterEl){
      counterEl.textContent = Number(value || FALLBACK_VISITS).toLocaleString('ar-SA');
    }
  }

  function markIncrementAttempted(){
    if(incrementAttempted) return false;
    incrementAttempted = true;

    try{
      if(sessionStorage.getItem(SESSION_KEY) === '1') return false;
      sessionStorage.setItem(SESSION_KEY, '1');
    }catch(_){
      // يكفي المتغير المحلي لمنع التكرار داخل تحميل الصفحة الحالي.
    }
    return true;
  }

  renderVisits(FALLBACK_VISITS);

  try{
    const [{ initializeApp }, firestore] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js')
    ]);
    const { getFirestore, doc, runTransaction, onSnapshot, setLogLevel } = firestore;

    // فشل العداد متوقع عند تعذر الشبكة أو الصلاحيات، ولا يستدعي إزعاج Console.
    setLogLevel('silent');

    const firebaseConfig = {
      apiKey: 'AIzaSyD6ewzxqeXlpueL5KZ51HiZgrf6pBrAyXY',
      authDomain: 'fhz545-teachers.firebaseapp.com',
      projectId: 'fhz545-teachers',
      storageBucket: 'fhz545-teachers.firebasestorage.app',
      messagingSenderId: '475715515720',
      appId: '1:475715515720:web:9b0d894433fe8500566f7d'
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const counterRef = doc(db, 'site', 'counter');

    onSnapshot(
      counterRef,
      (snap) => {
        const visits = snap.exists() ? (snap.data().visits ?? FALLBACK_VISITS) : FALLBACK_VISITS;
        renderVisits(visits);
      },
      () => {
        renderVisits(FALLBACK_VISITS);
      }
    );

    if(!markIncrementAttempted()) return;

    try{
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);
        const current = snap.exists() ? (snap.data().visits ?? FALLBACK_VISITS) : FALLBACK_VISITS;
        tx.set(counterRef, { visits: current + 1 }, { merge: true });
      });
    }catch(_){
      // Best-effort: تبقى القيمة المعروضة هادئة ولا تتكرر محاولة الكتابة في الجلسة.
    }
  }catch(_){
    // فشل تحميل Firebase لا يؤثر في بقية الصفحة أو المساعد.
  }
})();
