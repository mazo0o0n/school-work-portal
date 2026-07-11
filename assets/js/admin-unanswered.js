const adminTokenInput = document.getElementById('adminToken');
const connectBtn = document.getElementById('connectBtn');
const logoutBtn = document.getElementById('logoutBtn');
const refreshBtn = document.getElementById('refreshBtn');
const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');
const questionsList = document.getElementById('questionsList');
const questionTemplate = document.getElementById('questionTemplate');
const statusLine = document.getElementById('statusLine');
const totalCount = document.getElementById('totalCount');
const currentStatus = document.getElementById('currentStatus');
const tabs = [...document.querySelectorAll('.tab')];
const adminContent = [...document.querySelectorAll('.admin-content')];

let adminToken = '';
let currentItems = [];
let activeStatus = 'new';
let busy = false;

const statusLabels = {
  new: 'جديد',
  reviewed: 'تمت المراجعة',
  added_to_knowledge: 'أضيف للمعرفة',
  ignored: 'متجاهل'
};

function setStatus(message, type = ''){
  statusLine.textContent = message;
  statusLine.className = `status-line ${type}`.trim();
}

function setBusy(value){
  busy = value;
  document.querySelectorAll('button').forEach((button) => {
    button.disabled = value;
  });
}

function setAdminVisible(value){
  adminContent.forEach((element) => {
    element.hidden = !value;
  });
  logoutBtn.hidden = !value;
}

function clearChildren(element){
  while(element.firstChild){
    element.removeChild(element.firstChild);
  }
}

function resetSession(message = 'تم تسجيل الخروج ومسح الرمز من الذاكرة.', type = 'success'){
  adminToken = '';
  adminTokenInput.value = '';
  currentItems = [];
  setAdminVisible(false);
  renderItems();
  setStatus(message, type);
  adminTokenInput.focus();
}

function requireToken(){
  if(adminToken) return true;
  setStatus('أدخل رمز الإدارة أولًا.', 'error');
  adminTokenInput.focus();
  return false;
}

async function apiRequest(url, options = {}){
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-Admin-Token': adminToken
    }
  });

  if(response.status === 403){
    resetSession('رمز الإدارة غير صحيح أو انتهت صلاحية الجلسة.', 'error');
    throw new Error('رمز الإدارة غير صحيح أو انتهت صلاحية الجلسة.');
  }

  if(response.status === 404){
    throw new Error('تعذر الوصول إلى خدمة الإدارة حاليًا.');
  }

  if(!response.ok){
    throw new Error('فشل الاتصال بخدمة الإدارة.');
  }

  return response.json();
}

function formatDate(value){
  if(!value) return '-';
  const date = new Date(value);
  if(Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ar-SA', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function cleanMarkdownQuestion(value){
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^#+\s*/, '')
    .trim() || 'سؤال غير محدد';
}

function buildKnowledgeTemplate(item){
  const question = cleanMarkdownQuestion(item?.question);
  const status = String(item?.status || '-').trim() || '-';
  const repeatCount = String(item?.repeat_count ?? 0).trim() || '0';

  return [
    `### ${question}`,
    '',
    'الإجابة:',
    'اكتب الإجابة المؤكدة هنا بناءً على مصدر معتمد من ملفات المنصة.',
    '',
    'المصدر:',
    'اذكر اسم الملف أو المرجع المعتمد هنا.',
    '',
    'ملاحظات:',
    '- أضيف هذا السؤال من سجل الأسئلة غير المجابة.',
    `- الحالة قبل الإضافة: ${status}`,
    `- عدد التكرار: ${repeatCount}`
  ].join('\n');
}

async function copyText(text){
  if(navigator.clipboard?.writeText){
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function getSortedFilteredItems(){
  const query = searchInput.value.trim().toLowerCase();
  const filtered = currentItems.filter((item) => {
    if(!query) return true;
    return [
      item.question,
      item.reason,
      item.status,
      item.page_path,
      item.source
    ].some((value) => String(value || '').toLowerCase().includes(query));
  });

  return filtered.sort((a, b) => {
    const aDate = new Date(a.updated_at || a.created_at || 0);
    const bDate = new Date(b.updated_at || b.created_at || 0);
    const aTime = Number.isNaN(aDate.getTime()) ? 0 : aDate.getTime();
    const bTime = Number.isNaN(bDate.getTime()) ? 0 : bDate.getTime();

    if(sortSelect.value === 'oldest'){
      return aTime - bTime;
    }
    if(sortSelect.value === 'repeat'){
      return Number(b.repeat_count || 0) - Number(a.repeat_count || 0);
    }
    return bTime - aTime;
  });
}

function renderItems(){
  clearChildren(questionsList);
  const items = getSortedFilteredItems();
  totalCount.textContent = `${items.length} سؤال`;
  currentStatus.textContent = `الحالة: ${statusLabels[activeStatus] || activeStatus}`;

  if(!items.length){
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = currentItems.length ? 'لا توجد نتائج مطابقة للبحث.' : 'لا توجد أسئلة في هذه الحالة.';
    questionsList.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const card = questionTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.id = item.id;
    const question = String(item.question || '-');
    card.querySelector('.question-text').textContent = question;
    card.querySelector('.status-badge').textContent = statusLabels[item.status] || item.status || '-';
    card.querySelector('.reason').textContent = item.reason || '-';
    card.querySelector('.repeat').textContent = item.repeat_count || 0;
    card.querySelector('.page-path').textContent = item.page_path || '-';
    card.querySelector('.source').textContent = item.source || '-';
    card.querySelector('.created').textContent = formatDate(item.created_at);
    card.querySelector('.updated').textContent = formatDate(item.updated_at);
    questionsList.appendChild(card);
  });
}

async function loadQuestions(){
  if(!requireToken() || busy) return;
  setBusy(true);
  setStatus('جاري تحميل الأسئلة...');

  try{
    const data = await apiRequest(`/api/admin/unanswered?status=${encodeURIComponent(activeStatus)}`);
    currentItems = Array.isArray(data.items) ? data.items : [];
    setAdminVisible(true);
    renderItems();
    adminTokenInput.value = '';
    setStatus('تم تحديث البيانات بنجاح.', 'success');
  }catch(error){
    currentItems = [];
    renderItems();
    setStatus(error.message || 'فشل الاتصال.', 'error');
  }finally{
    setBusy(false);
  }
}

async function updateStatus(id, status){
  if(!requireToken() || busy) return;
  setBusy(true);
  setStatus('جاري تحديث الحالة...');

  try{
    await apiRequest(`/api/admin/unanswered/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    setStatus('تم تغيير الحالة بنجاح.', 'success');
    setBusy(false);
    await loadQuestions();
  }catch(error){
    setStatus(error.message || 'فشل تغيير الحالة.', 'error');
  }finally{
    setBusy(false);
  }
}

async function deleteQuestion(id){
  if(!requireToken() || busy) return;
  const item = currentItems.find((entry) => Number(entry.id) === Number(id));
  const questionPreview = String(item?.question || '').slice(0, 80);
  const confirmed = window.confirm(`هل تريد حذف هذا السؤال؟\n${questionPreview}\nلا يمكن التراجع عن الحذف.`);
  if(!confirmed) return;

  setBusy(true);
  setStatus('جاري حذف السؤال...');

  try{
    await apiRequest(`/api/admin/unanswered/${id}`, { method: 'DELETE' });
    setStatus('تم حذف السؤال بنجاح.', 'success');
    setBusy(false);
    await loadQuestions();
  }catch(error){
    setStatus(error.message || 'فشل حذف السؤال.', 'error');
  }finally{
    setBusy(false);
  }
}

connectBtn.addEventListener('click', () => {
  adminToken = adminTokenInput.value.trim();
  if(!adminToken){
    setStatus('أدخل رمز الإدارة أولًا.', 'error');
    return;
  }
  loadQuestions();
});

adminTokenInput.addEventListener('keydown', (event) => {
  if(event.key === 'Enter'){
    event.preventDefault();
    connectBtn.click();
  }
});

logoutBtn.addEventListener('click', () => {
  resetSession();
});

refreshBtn.addEventListener('click', loadQuestions);
searchInput.addEventListener('input', renderItems);
sortSelect.addEventListener('change', renderItems);

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    activeStatus = tab.dataset.status;
    tabs.forEach((item) => item.classList.toggle('active', item === tab));
    if(adminToken){
      loadQuestions();
    }else{
      renderItems();
    }
  });
});

questionsList.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  const card = event.target.closest('.question-card');
  if(!button || !card) return;

  const id = Number(card.dataset.id);
  const item = currentItems.find((entry) => Number(entry.id) === id);

  if(button.dataset.action === 'copy'){
    const text = card.querySelector('.question-text')?.textContent || '';
    try{
      await copyText(text);
      setStatus('تم نسخ نص السؤال.', 'success');
    }catch(_){
      setStatus('تعذر نسخ السؤال من المتصفح.', 'error');
    }
    return;
  }

  if(button.dataset.action === 'copy-template'){
    try{
      await copyText(buildKnowledgeTemplate(item));
      setStatus('تم نسخ قالب المعرفة.', 'success');
    }catch(_){
      setStatus('تعذر نسخ قالب المعرفة من المتصفح.', 'error');
    }
    return;
  }

  if(button.dataset.action === 'delete'){
    deleteQuestion(id);
    return;
  }

  if(button.dataset.statusAction){
    updateStatus(id, button.dataset.statusAction);
  }
});

renderItems();
setAdminVisible(false);
adminTokenInput.focus();
