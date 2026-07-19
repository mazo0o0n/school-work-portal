const qaCount = document.getElementById('qaCount');
const sourcesCount = document.getElementById('sourcesCount');
const updatedAt = document.getElementById('updatedAt');
const statsState = document.getElementById('statsState');
const statsMessage = document.getElementById('statsMessage');
const refreshStats = document.getElementById('refreshStats');
const themeToggle = document.getElementById('themeToggle');
const adminTokenInput = document.getElementById('adminToken');
const loadUnanswered = document.getElementById('loadUnanswered');
const clearToken = document.getElementById('clearToken');
const unansweredCount = document.getElementById('unansweredCount');
const adminMessage = document.getElementById('adminMessage');

let adminToken = '';

function setMessage(element, text, type = ''){
  element.textContent = text;
  element.className = `message ${type}`.trim();
}

function formatUpdatedAt(value){
  if(!value) return 'غير متوفر';
  const date = new Date(value);
  if(Number.isNaN(date.getTime())) return 'غير متوفر';
  return date.toLocaleString('ar-SA', { dateStyle:'medium', timeStyle:'short' });
}

async function loadKnowledgeStats(){
  statsState.textContent = 'جاري التحميل…';
  setMessage(statsMessage, '');
  try{
    const response = await fetch('assets/data/knowledge-stats.json', { cache:'no-store' });
    if(!response.ok) throw new Error('Stats request failed');
    const data = await response.json();
    if(!Number.isInteger(data.qa_count) || !Number.isInteger(data.sources_count)){
      throw new Error('Invalid stats');
    }
    qaCount.textContent = data.qa_count.toLocaleString('ar-SA');
    sourcesCount.textContent = data.sources_count.toLocaleString('ar-SA');
    updatedAt.textContent = formatUpdatedAt(data.updated_at);
    statsState.textContent = 'موجود';
    setMessage(statsMessage, 'تم تحميل إحصاءات المعرفة بنجاح.', 'success');
  }catch{
    qaCount.textContent = '—';
    sourcesCount.textContent = '—';
    updatedAt.textContent = 'غير متوفر';
    statsState.textContent = 'فشل التحميل أو الملف غير موجود';
    setMessage(statsMessage, 'تعذر تحميل إحصاءات المعرفة. يبقى fallback في المساعد مستقلًا عن هذه الصفحة.', 'error');
  }
}

async function requestUnansweredSummary(){
  const response = await fetch('/api/admin/unanswered?summary=1', {
    headers:{ 'X-Admin-Token':adminToken }
  });
  if(response.status === 429) throw new Error('تم تجاوز عدد محاولات الدخول. انتظر دقيقة ثم حاول مرة أخرى.');
  if(response.status === 403) throw new Error('رمز الإدارة غير صحيح أو غير مخول.');
  if(!response.ok) throw new Error('خدمة الإدارة غير متاحة حاليًا.');
  const data = await response.json();
  const total = Number(data?.counts?.all);
  if(!Number.isSafeInteger(total) || total < 0){
    throw new Error('استجابة الإدارة غير صالحة.');
  }
  return total;
}

async function loadUnansweredCount(){
  adminToken = adminTokenInput.value.trim();
  if(!adminToken){
    setMessage(adminMessage, 'أدخل Admin Token يدويًا أولًا.', 'error');
    return;
  }
  loadUnanswered.disabled = true;
  setMessage(adminMessage, 'جاري تحميل العدد…');
  try{
    const total = await requestUnansweredSummary();
    unansweredCount.textContent = total.toLocaleString('ar-SA');
    adminTokenInput.value = '';
    setMessage(adminMessage, 'تم تحميل العدد. الرمز محفوظ في ذاكرة الصفحة فقط.', 'success');
  }catch(error){
    adminToken = '';
    unansweredCount.textContent = 'غير متاح';
    setMessage(adminMessage, error.message || 'تعذر تحميل العدد.', 'error');
  }finally{
    loadUnanswered.disabled = false;
  }
}

function clearAdminToken(){
  adminToken = '';
  adminTokenInput.value = '';
  unansweredCount.textContent = 'غير متاح';
  setMessage(adminMessage, 'تم مسح الرمز من ذاكرة الصفحة.');
}

function toggleTheme(){
  const isDark = document.body.classList.toggle('dark');
  themeToggle.setAttribute('aria-pressed', String(isDark));
}

refreshStats.addEventListener('click', loadKnowledgeStats);
loadUnanswered.addEventListener('click', loadUnansweredCount);
clearToken.addEventListener('click', clearAdminToken);
themeToggle.addEventListener('click', toggleTheme);
adminTokenInput.addEventListener('keydown', (event) => {
  if(event.key === 'Enter'){
    event.preventDefault();
    loadUnansweredCount();
  }
});

loadKnowledgeStats();
