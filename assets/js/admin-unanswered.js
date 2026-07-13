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

const reasonLabels = {
  generated_fallback: 'رد افتراضي من المساعد',
  no_matches: 'لا توجد نتيجة مناسبة',
  low_score: 'نتيجة ضعيفة',
  external_guard: 'خارج نطاق معرفة المنصة',
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

async function apiRequest(url, options = {}, resetOnForbidden = true){
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-Admin-Token': adminToken
    }
  });

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

function renderAggregateInsights(items){
  if(!items.length){
    topReason.textContent = 'لا توجد بيانات كافية';
    topQuestion.textContent = 'لا توجد بيانات كافية';
    renderUnavailableList(topRepeatedList);
    renderUnavailableList(reasonDistribution);
    return;
  }

  const reasonCounts = items.reduce((counts, item) => {
    const reason = String(item.reason || 'unknown').trim() || 'unknown';
    counts.set(reason, (counts.get(reason) || 0) + 1);
    return counts;
  }, new Map());
  const [mostCommonReason, reasonCount] = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0];
  topReason.textContent = `${displayReason(mostCommonReason)} (${reasonCount.toLocaleString('ar-SA')})`;

  const mostRepeated = items.reduce((topItem, item) => {
    return Number(item.repeat_count || 0) > Number(topItem.repeat_count || 0) ? item : topItem;
  }, items[0]);
  const repeatCount = Number(mostRepeated.repeat_count || 0);
  topQuestion.textContent = `${cleanMarkdownQuestion(mostRepeated.question)} (${repeatCount.toLocaleString('ar-SA')})`;

  topRepeatedList.replaceChildren();
  [...items]
    .sort((a, b) => Number(b.repeat_count || 0) - Number(a.repeat_count || 0))
    .slice(0, 5)
    .forEach((item) => {
      const listItem = document.createElement('li');
      const count = Number(item.repeat_count || 0).toLocaleString('ar-SA');
      listItem.textContent = `${cleanMarkdownQuestion(item.question)} — ${count} تكرار`;
      topRepeatedList.appendChild(listItem);
    });

  reasonDistribution.replaceChildren();
  [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([reason, count]) => {
      const listItem = document.createElement('li');
      listItem.textContent = `${displayReason(reason)}: ${count.toLocaleString('ar-SA')}`;
      reasonDistribution.appendChild(listItem);
    });
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
    const statuses = Object.keys(statisticsCountElements);
    const responses = await Promise.all(statuses.map((status) => {
      return apiRequest(`/api/admin/unanswered?status=${encodeURIComponent(status)}`, {}, false);
    }));

    const allItems = [];
    responses.forEach((data, index) => {
      if(!Array.isArray(data.items)) throw new Error('Invalid statistics response');
      statisticsCountElements[statuses[index]].textContent = data.items.length.toLocaleString('ar-SA');
      allItems.push(...data.items);
    });
    allStatsCount.textContent = allItems.length.toLocaleString('ar-SA');
    renderAggregateInsights(allItems);
  }catch(_){
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

function updateReasonFilter(){
  const selectedReason = reasonFilter.value;
  const reasons = [...new Set(currentItems.map((item) => String(item.reason || 'unknown').trim() || 'unknown'))]
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
  const query = searchInput.value.trim().toLowerCase();
  const selectedReason = reasonFilter.value;
  const filtered = currentItems.filter((item) => {
    const itemReason = String(item.reason || 'unknown').trim() || 'unknown';
    if(selectedReason && itemReason !== selectedReason) return false;
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
  renderVisibleCount(items);

  if(!items.length){
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = currentItems.length ? 'لا توجد نتائج مطابقة للفلتر.' : 'لا توجد أسئلة غير مجابة حاليًا.';
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

async function loadQuestions(){
  if(!requireToken() || busy) return;
  setBusy(true);
  setStatus('جاري تحميل الأسئلة...');

  try{
    const data = await apiRequest(`/api/admin/unanswered?status=${encodeURIComponent(activeStatus)}`);
    currentItems = Array.isArray(data.items) ? data.items : [];
    updateReasonFilter();
    setAdminVisible(true);
    renderItems();
    adminTokenInput.value = '';
    setStatus('متصل. تم تحديث البيانات بنجاح.', 'success');
    await loadStatistics();
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
  }catch(_){
    setStatus('تعذر نسخ القوالب الظاهرة من المتصفح.', 'error');
  }
});
searchInput.addEventListener('input', renderItems);
reasonFilter.addEventListener('change', renderItems);
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

  if(button.dataset.action === 'copy-question'){
    try{
      await copyText(cleanMarkdownQuestion(item?.question));
      setStatus('تم نسخ السؤال.', 'success');
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
