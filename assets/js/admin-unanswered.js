const adminTokenInput = document.getElementById('adminToken');
const connectBtn = document.getElementById('connectBtn');
const logoutBtn = document.getElementById('logoutBtn');
const refreshBtn = document.getElementById('refreshBtn');
const bulkCopyBtn = document.getElementById('bulkCopyBtn');
const searchInput = document.getElementById('searchInput');
const reasonFilter = document.getElementById('reasonFilter');
const sortSelect = document.getElementById('sortSelect');
const questionsList = document.getElementById('questionsList');
const questionTemplate = document.getElementById('questionTemplate');
const statusLine = document.getElementById('statusLine');
const totalCount = document.getElementById('totalCount');
const currentStatus = document.getElementById('currentStatus');
const statisticsAlert = document.getElementById('statisticsAlert');
const topReason = document.getElementById('topReason');
const topQuestion = document.getElementById('topQuestion');
const topRepeatedList = document.getElementById('topRepeatedList');
const reasonDistribution = document.getElementById('reasonDistribution');
const visibleQuestionsCount = document.getElementById('visibleQuestionsCount');
const paginationControls = document.getElementById('paginationControls');
const previousPageBtn = document.getElementById('previousPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageIndicator = document.getElementById('pageIndicator');
const tabs = [...document.querySelectorAll('.tab')];
const adminContent = [...document.querySelectorAll('.admin-content')];

let adminToken = '';
let currentItems = [];
let currentTotal = 0;
let activeStatus = 'new';
let busy = false;
let currentCursor = '';
let nextCursor = '';
let cursorHistory = [];
let currentPage = 1;
let searchTimer = 0;
const pageSize = 25;

const statusLabels = {
  new: 'جديد',
  reviewed: 'تمت المراجعة',
  added_to_knowledge: 'أضيف للمعرفة',
  ignored: 'متجاهل'
};

const reasonLabels = {
  generated_fallback: 'رد افتراضي من المساعد',
  no_matches: 'لا توجد نتيجة مناسبة',
  low_score: 'نتيجة ضعيفة',
  external_guard: 'خارج نطاق معرفة المنصة',
  strict_rag_failed: 'خطأ مؤقت في البحث',
  unknown: 'غير معروف'
};

const statisticsCountElements = {
  new: document.getElementById('newStatsCount'),
  reviewed: document.getElementById('reviewedStatsCount'),
  added_to_knowledge: document.getElementById('addedStatsCount'),
  ignored: document.getElementById('ignoredStatsCount')
};
const allStatsCount = document.getElementById('allStatsCount');

function setStatus(message, type = ''){
  statusLine.textContent = message;
  statusLine.className = `status-line ${type}`.trim();
}

function setBusy(value){
  busy = value;
  document.querySelectorAll('button').forEach((button) => {
    button.disabled = value;
  });
  updatePagination();
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
  currentTotal = 0;
  currentCursor = '';
  nextCursor = '';
  cursorHistory = [];
  currentPage = 1;
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

async function apiRequest(url, options = {}, resetOnForbidden = true){
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-Admin-Token': adminToken
    }
  });

  if(response.status === 429){
    resetSession('تم تجاوز عدد محاولات الدخول. انتظر دقيقة ثم حاول مرة أخرى.', 'error');
    throw new Error('تم تجاوز عدد محاولات الدخول. انتظر دقيقة ثم حاول مرة أخرى.');
  }

  if(response.status === 403){
    if(resetOnForbidden){
      resetSession('رمز الإدارة غير صحيح أو انتهت صلاحية الجلسة.', 'error');
    }
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

  return [
    `### ${question}`,
    '',
    '**الإجابة:**',
    '...',
    '',
    '**المصدر:**',
    '...',
    '',
    '**ملاحظات المراجعة:**',
    '- تمت مراجعة الإجابة بشريًا:',
    '- المصدر رسمي أو موثوق:',
    '- مناسب للإضافة إلى approved:'
  ].join('\n');
}

function displayReason(value){
  const reason = String(value || '').trim();
  return reasonLabels[reason] || reason || reasonLabels.unknown;
}

function renderVisibleCount(items){
  visibleQuestionsCount.textContent = items.length.toLocaleString('ar-SA');
}

function renderUnavailableList(element){
  element.replaceChildren();
  const item = document.createElement('li');
  item.textContent = 'غير متوفر';
  element.appendChild(item);
}

function renderAggregateInsights(data){
  const repeatedItems = Array.isArray(data?.top_questions) ? data.top_questions : [];
  const reasons = Array.isArray(data?.reason_distribution) ? data.reason_distribution : [];
  if(!repeatedItems.length && !reasons.length){
    topReason.textContent = 'لا توجد بيانات كافية';
    topQuestion.textContent = 'لا توجد بيانات كافية';
    renderUnavailableList(topRepeatedList);
    renderUnavailableList(reasonDistribution);
    return;
  }

  const topReasonItem = data?.top_reason;
  topReason.textContent = topReasonItem
    ? `${displayReason(topReasonItem.reason)} (${Number(topReasonItem.count || 0).toLocaleString('ar-SA')})`
    : 'لا توجد بيانات كافية';

  const mostRepeated = repeatedItems[0];
  const repeatCount = Number(mostRepeated?.repeat_count || 0);
  topQuestion.textContent = mostRepeated
    ? `${cleanMarkdownQuestion(mostRepeated.question)} (${repeatCount.toLocaleString('ar-SA')})`
    : 'لا توجد بيانات كافية';

  topRepeatedList.replaceChildren();
  if(repeatedItems.length){
    repeatedItems.forEach((item) => {
      const listItem = document.createElement('li');
      const count = Number(item.repeat_count || 0).toLocaleString('ar-SA');
      listItem.textContent = `${cleanMarkdownQuestion(item.question)} — ${count} تكرار`;
      topRepeatedList.appendChild(listItem);
    });
  }else{
    renderUnavailableList(topRepeatedList);
  }

  reasonDistribution.replaceChildren();
  if(reasons.length){
    reasons.forEach((item) => {
      const listItem = document.createElement('li');
      listItem.textContent = `${displayReason(item.reason)}: ${Number(item.count || 0).toLocaleString('ar-SA')}`;
      reasonDistribution.appendChild(listItem);
    });
  }else{
    renderUnavailableList(reasonDistribution);
  }
}

async function loadStatistics(){
  statisticsAlert.hidden = true;
  topReason.textContent = 'لا توجد بيانات كافية';
  topQuestion.textContent = 'لا توجد بيانات كافية';
  renderUnavailableList(topRepeatedList);
  renderUnavailableList(reasonDistribution);
  Object.values(statisticsCountElements).forEach((element) => {
    element.textContent = '—';
  });
  allStatsCount.textContent = '—';

  try{
    const data = await apiRequest('/api/admin/unanswered?summary=1', {}, false);
    Object.entries(statisticsCountElements).forEach(([status, element]) => {
      element.textContent = Number(data?.counts?.[status] || 0).toLocaleString('ar-SA');
    });
    allStatsCount.textContent = Number(data?.counts?.all || 0).toLocaleString('ar-SA');
    renderAggregateInsights(data);
    updateReasonFilter((data?.reason_distribution || []).map((item) => item.reason));
  }catch{
    Object.values(statisticsCountElements).forEach((element) => {
      element.textContent = '—';
    });
    topReason.textContent = 'لا توجد بيانات كافية';
    topQuestion.textContent = 'لا توجد بيانات كافية';
    renderUnavailableList(topRepeatedList);
    renderUnavailableList(reasonDistribution);
    allStatsCount.textContent = '—';
    statisticsAlert.hidden = false;
  }
}

function updateReasonFilter(availableReasons = []){
  const selectedReason = reasonFilter.value;
  const reasons = [...new Set(availableReasons.map((reason) => String(reason || 'unknown').trim() || 'unknown'))]
    .sort((a, b) => displayReason(a).localeCompare(displayReason(b), 'ar'));

  reasonFilter.replaceChildren();
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'كل أسباب عدم الإجابة';
  reasonFilter.appendChild(allOption);

  reasons.forEach((reason) => {
    const option = document.createElement('option');
    option.value = reason;
    option.textContent = displayReason(reason);
    reasonFilter.appendChild(option);
  });

  reasonFilter.value = reasons.includes(selectedReason) ? selectedReason : '';
}

function normalizeCardActions(card){
  card.querySelectorAll('[data-action="copy"]').forEach((button) => {
    button.remove();
  });

  card.querySelectorAll('[data-status-action]').forEach((button) => {
    const status = button.dataset.statusAction;
    button.textContent = statusLabels[status] || status;
  });
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
  return [...currentItems];
}

function resetPagination(){
  currentCursor = '';
  nextCursor = '';
  cursorHistory = [];
  currentPage = 1;
}

function updatePagination(){
  paginationControls.hidden = currentTotal === 0 && currentPage === 1;
  previousPageBtn.disabled = busy || cursorHistory.length === 0;
  nextPageBtn.disabled = busy || !nextCursor;
  pageIndicator.textContent = `الصفحة ${currentPage.toLocaleString('ar-SA')}`;
}

function buildQuestionsUrl(){
  const params = new URLSearchParams({
    status: activeStatus,
    limit: String(pageSize),
    sort: sortSelect.value
  });
  const query = searchInput.value.trim();
  const selectedReason = reasonFilter.value;

  if(query) params.set('q', query);
  if(selectedReason) params.set('reason', selectedReason);
  if(currentCursor) params.set('cursor', currentCursor);

  return `/api/admin/unanswered?${params.toString()}`;
}

function renderItems(){
  clearChildren(questionsList);
  const items = getSortedFilteredItems();
  totalCount.textContent = `${currentTotal.toLocaleString('ar-SA')} سؤال`;
  currentStatus.textContent = `الحالة: ${statusLabels[activeStatus] || activeStatus}`;
  renderVisibleCount(items);
  updatePagination();

  if(!items.length){
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = currentTotal ? 'لا توجد نتائج في هذه الصفحة.' : 'لا توجد أسئلة غير مجابة حاليًا.';
    questionsList.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const card = questionTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.id = item.id;
    normalizeCardActions(card);
    const question = String(item.question || '-');
    const repeatCount = Number(item.repeat_count || 0);
    if(repeatCount >= 5){
      card.classList.add('is-high-repeat');
    }else if(repeatCount >= 3){
      card.classList.add('is-repeated');
    }
    card.querySelector('.question-text').textContent = question;
    card.querySelector('.status-badge').textContent = statusLabels[item.status] || item.status || '-';
    card.querySelector('.reason').textContent = displayReason(item.reason);
    card.querySelector('.repeat').textContent = repeatCount;
    card.querySelector('.page-path').textContent = item.page_path || '-';
    card.querySelector('.source').textContent = item.source || '-';
    card.querySelector('.created').textContent = formatDate(item.created_at);
    card.querySelector('.updated').textContent = formatDate(item.updated_at);
    questionsList.appendChild(card);
  });
}

async function loadQuestions({ reset = false, refreshStatistics = true } = {}){
  if(!requireToken() || busy) return;
  if(reset) resetPagination();
  setBusy(true);
  setStatus('جاري تحميل الأسئلة...');

  try{
    const data = await apiRequest(buildQuestionsUrl());
    currentItems = Array.isArray(data.items) ? data.items : [];
    currentTotal = Number(data.total ?? data.total_new ?? currentItems.length);
    nextCursor = String(data?.pagination?.next_cursor || '');
    setAdminVisible(true);
    renderItems();
    adminTokenInput.value = '';
    setStatus('متصل. تم تحديث البيانات بنجاح.', 'success');
    if(refreshStatistics) await loadStatistics();
  }catch(error){
    currentItems = [];
    currentTotal = 0;
    nextCursor = '';
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
  loadQuestions({ reset: true });
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

refreshBtn.addEventListener('click', () => loadQuestions());
bulkCopyBtn.addEventListener('click', async () => {
  const items = getSortedFilteredItems();
  if(!items.length){
    setStatus('لا توجد أسئلة ظاهرة لنسخها.', 'error');
    return;
  }

  const markdown = items
    .map((item) => `${buildKnowledgeTemplate(item)}\n\n---`)
    .join('\n\n');

  try{
    await copyText(markdown);
    setStatus('تم نسخ القوالب الظاهرة.', 'success');
  }catch{
    setStatus('تعذر نسخ القوالب الظاهرة من المتصفح.', 'error');
  }
});
searchInput.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    loadQuestions({ reset: true, refreshStatistics: false });
  }, 250);
});
reasonFilter.addEventListener('change', () => {
  loadQuestions({ reset: true, refreshStatistics: false });
});
sortSelect.addEventListener('change', () => {
  loadQuestions({ reset: true, refreshStatistics: false });
});

previousPageBtn.addEventListener('click', () => {
  if(!cursorHistory.length || busy) return;
  currentCursor = cursorHistory.pop() || '';
  currentPage = Math.max(1, currentPage - 1);
  loadQuestions({ refreshStatistics: false });
});

nextPageBtn.addEventListener('click', () => {
  if(!nextCursor || busy) return;
  cursorHistory.push(currentCursor);
  currentCursor = nextCursor;
  currentPage += 1;
  loadQuestions({ refreshStatistics: false });
});

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    activeStatus = tab.dataset.status;
    tabs.forEach((item) => item.classList.toggle('active', item === tab));
    if(adminToken){
      loadQuestions({ reset: true, refreshStatistics: false });
    }else{
      resetPagination();
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

  if(button.dataset.action === 'copy-question'){
    try{
      await copyText(cleanMarkdownQuestion(item?.question));
      setStatus('تم نسخ السؤال.', 'success');
    }catch{
      setStatus('تعذر نسخ السؤال من المتصفح.', 'error');
    }
    return;
  }

  if(button.dataset.action === 'copy-template'){
    try{
      await copyText(buildKnowledgeTemplate(item));
      setStatus('تم نسخ قالب المعرفة.', 'success');
    }catch{
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
