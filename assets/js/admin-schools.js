const adminTokenInput = document.getElementById('adminToken');
const accessTitle = document.getElementById('accessTitle');
const accessDescription = document.getElementById('accessDescription');
const tokenRow = document.querySelector('.token-row');
const connectBtn = document.getElementById('connectBtn');
const logoutBtn = document.getElementById('logoutBtn');
const refreshBtn = document.getElementById('refreshBtn');
const statusLine = document.getElementById('statusLine');
const searchInput = document.getElementById('searchInput');
const stageFilter = document.getElementById('stageFilter');
const statusFilter = document.getElementById('statusFilter');
const sortSelect = document.getElementById('sortSelect');
const resultsSummary = document.getElementById('resultsSummary');
const schoolsTableBody = document.getElementById('schoolsTableBody');
const emptyState = document.getElementById('emptyState');
const previousPageBtn = document.getElementById('previousPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageIndicator = document.getElementById('pageIndicator');
const schoolRowTemplate = document.getElementById('schoolRowTemplate');
const auditRefreshBtn = document.getElementById('auditRefreshBtn');
const auditTableBody = document.getElementById('auditTableBody');
const auditEmptyState = document.getElementById('auditEmptyState');
const auditRowTemplate = document.getElementById('auditRowTemplate');
const deleteSchoolDialog = document.getElementById('deleteSchoolDialog');
const deleteSchoolForm = document.getElementById('deleteSchoolForm');
const deleteSchoolName = document.getElementById('deleteSchoolName');
const deleteSchoolStage = document.getElementById('deleteSchoolStage');
const deleteSchoolDepartment = document.getElementById('deleteSchoolDepartment');
const deleteConfirmationInput = document.getElementById('deleteConfirmationInput');
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
const adminContent = [...document.querySelectorAll('.admin-content')];

const countElements = {
  all: document.getElementById('allCount'),
  unverified: document.getElementById('unverifiedCount'),
  pending: document.getElementById('pendingCount'),
  verified: document.getElementById('verifiedCount'),
  suspended: document.getElementById('suspendedCount')
};

const stageCountElements = {
  ابتدائية: document.getElementById('primaryCount'),
  متوسطة: document.getElementById('middleCount'),
  ثانوية: document.getElementById('secondaryCount')
};

const statusLabels = {
  unverified: 'غير متحققة',
  pending: 'بانتظار المراجعة',
  verified: 'متحققة',
  suspended: 'موقوفة'
};

const auditActionLabels = {
  school_status_changed: 'تغيير حالة مدرسة',
  school_deleted: 'حذف مدرسة'
};

const auditResultLabels = {
  success: 'ناجحة'
};

let adminToken = '';
let currentPage = 1;
let totalPages = 1;
let busy = false;
let searchTimer = 0;
let autoRefreshTimer = 0;
let refreshInFlightSession = 0;
let knownSchoolTotal = null;
let lastAutomaticRefreshAt = 0;
let pendingDeleteSchool = null;
let adminSessionId = 0;
const pageSize = 25;
const autoRefreshIntervalMs = 15000;
const automaticRefreshCooldownMs = 1000;

function setStatus(message, type = ''){
  statusLine.textContent = message;
  statusLine.className = `status-line ${type}`.trim();
}

function setAdminVisible(value){
  adminContent.forEach((element) => {
    element.hidden = !value;
  });
  accessTitle.textContent = value ? 'جلسة الإدارة' : 'الدخول الإداري';
  accessDescription.textContent = value
    ? 'تم تفعيل الجلسة الإدارية مؤقتًا. لا يتم حفظ رمز الإدارة في المتصفح، وسيتم إنهاء الجلسة عند تسجيل الخروج أو إغلاق الصفحة.'
    : 'أدخل رمز الإدارة. لا يتم حفظ الرمز في المتصفح، ويُمسح عند إغلاق الصفحة أو تسجيل الخروج.';
  adminTokenInput.hidden = value;
  tokenRow.classList.toggle('session-active', value);
  logoutBtn.hidden = !value;
  connectBtn.hidden = value;
  if(value) adminTokenInput.value = '';
}

function setBusy(value){
  busy = value;
  document.querySelectorAll('button, select').forEach((element) => {
    element.disabled = value;
  });
  adminTokenInput.disabled = value;
  searchInput.disabled = value;
  updatePagination();
}

function resetCounts(){
  Object.values(countElements).forEach((element) => {
    element.textContent = '—';
  });
  Object.values(stageCountElements).forEach((element) => {
    element.textContent = '—';
  });
}

function resetSession(message = 'تم تسجيل الخروج ومسح رمز الإدارة من الذاكرة.', type = 'success'){
  stopAutoRefresh();
  closeDeleteDialog();
  adminSessionId += 1;
  adminToken = '';
  adminTokenInput.value = '';
  currentPage = 1;
  totalPages = 1;
  knownSchoolTotal = null;
  schoolsTableBody.replaceChildren();
  auditTableBody.replaceChildren();
  auditEmptyState.hidden = true;
  resetCounts();
  setAdminVisible(false);
  updatePagination();
  setStatus(message, type);
  adminTokenInput.focus();
}

async function apiRequest(url, options = {}, resetOnForbidden = true){
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-Admin-Token': adminToken
    }
  });

  let body;
  try{
    body = await response.json();
  }catch{
    body = {};
  }

  if(response.status === 429){
    resetSession('تم تجاوز عدد محاولات الدخول. انتظر دقيقة ثم حاول مرة أخرى.', 'error');
    throw new Error('تم تجاوز عدد محاولات الدخول.');
  }

  if(response.status === 403){
    if(resetOnForbidden){
      resetSession('رمز الإدارة غير صحيح.', 'error');
    }
    throw new Error('رمز الإدارة غير صحيح.');
  }

  if(response.status === 404){
    throw new Error('خدمة إدارة المدارس غير متاحة حاليًا.');
  }

  if(!response.ok){
    throw new Error(body.error || 'فشل الاتصال بخدمة إدارة المدارس.');
  }

  return body;
}

function formatDate(value){
  if(!value) return '—';
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const date = new Date(normalized);
  if(Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ar-SA', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function auditMetadataText(item){
  const metadata = item?.metadata || {};
  if(item?.action === 'school_status_changed'){
    const previous = statusLabels[metadata.previous_status] || metadata.previous_status;
    const next = statusLabels[metadata.new_status] || metadata.new_status;
    if(previous && next) return `من «${previous}» إلى «${next}»`;
  }
  if(item?.action === 'school_deleted'){
    const status = statusLabels[metadata.verification_status] || metadata.verification_status;
    if(status) return `الحالة قبل الحذف: ${status}`;
  }
  return '—';
}

function createAuditRow(item){
  const fragment = auditRowTemplate.content.cloneNode(true);
  fragment.querySelector('.audit-created-at').textContent = formatDate(item.created_at);
  fragment.querySelector('.audit-action').textContent = auditActionLabels[item.action] || 'عملية إدارية';
  fragment.querySelector('.audit-entity-type').textContent = item.entity_type === 'school' ? 'مدرسة' : '—';
  fragment.querySelector('.audit-entity-id').textContent = item.entity_id || '—';
  const result = fragment.querySelector('.audit-result');
  result.textContent = auditResultLabels[item.result] || 'مسجلة';
  result.classList.toggle('success', item.result === 'success');
  fragment.querySelector('.audit-metadata').textContent = auditMetadataText(item);
  return fragment;
}

function renderAuditLogs(data){
  const items = Array.isArray(data?.items) ? data.items : [];
  auditTableBody.replaceChildren(...items.map(createAuditRow));
  auditEmptyState.hidden = items.length > 0;
  const message = auditEmptyState.querySelector('span');
  if(message) message.textContent = 'ستظهر هنا عمليات تحديث الحالة والحذف بعد تسجيلها.';
}

function renderSummary(data){
  const statusCounts = data?.status_counts || {};
  const stageCounts = data?.stage_counts || {};

  Object.entries(countElements).forEach(([status, element]) => {
    element.textContent = Number(statusCounts[status] || 0).toLocaleString('ar-SA');
  });

  Object.entries(stageCountElements).forEach(([stage, element]) => {
    element.textContent = Number(stageCounts[stage] || 0).toLocaleString('ar-SA');
  });
}

function statusClass(status){
  return Object.hasOwn(statusLabels, status) ? status : 'unverified';
}

function createSchoolRow(school){
  const fragment = schoolRowTemplate.content.cloneNode(true);
  const row = fragment.querySelector('tr');
  const select = row.querySelector('.status-action');
  const saveButton = row.querySelector('.save-status-btn');
  const deleteButton = row.querySelector('.delete-btn');
  const status = statusClass(String(school.verification_status || 'unverified'));

  row.querySelector('.school-name').textContent = school.school_name || 'مدرسة بدون اسم';
  row.querySelector('.school-id').textContent = school.public_id || '—';
  row.querySelector('.school-stage').textContent = school.school_stage || '—';
  row.querySelector('.education-department').textContent = school.education_department || '—';
  row.querySelector('.registration-contact-name').textContent =
    school.registration_contact_name || 'مسؤول غير مسمى';
  const contactPhone = row.querySelector('.registration-contact-phone');
  const registrationContactPhone = String(school.registration_contact_phone || '').trim();
  contactPhone.textContent = registrationContactPhone || 'لا يوجد رقم محفوظ';
  contactPhone.classList.toggle('has-phone', Boolean(registrationContactPhone));
  row.querySelector('.created-at').textContent = formatDate(school.created_at);

  const badge = row.querySelector('.status-badge');
  badge.textContent = statusLabels[status];
  badge.classList.add(status);
  select.value = status;

  saveButton.addEventListener('click', async () => {
    if(select.value === status){
      setStatus('لم تتغير حالة المدرسة.', 'success');
      return;
    }
    await updateSchoolStatus(school, select.value);
  });

  deleteButton.addEventListener('click', () => {
    requestSchoolDeletion(school);
  });

  return fragment;
}

function renderSchools(data){
  const items = Array.isArray(data?.items) ? data.items : [];
  const total = Number(data?.total || 0);
  const pagination = data?.pagination || {};
  currentPage = Number(pagination.page || 1);
  totalPages = Number(pagination.pages || 1);

  schoolsTableBody.replaceChildren(...items.map(createSchoolRow));
  emptyState.hidden = items.length > 0;
  resultsSummary.textContent = `${total.toLocaleString('ar-SA')} مدرسة`;
  updatePagination();
}

function updatePagination(){
  previousPageBtn.disabled = busy || currentPage <= 1;
  nextPageBtn.disabled = busy || currentPage >= totalPages;
  pageIndicator.textContent = `الصفحة ${currentPage.toLocaleString('ar-SA')} من ${totalPages.toLocaleString('ar-SA')}`;
}

function buildSchoolsUrl(){
  const params = new URLSearchParams({
    page: String(currentPage),
    limit: String(pageSize),
    sort: sortSelect.value
  });

  const search = searchInput.value.trim();
  if(search) params.set('q', search);
  if(stageFilter.value) params.set('stage', stageFilter.value);
  if(statusFilter.value) params.set('status', statusFilter.value);

  return `/api/admin/schools?${params.toString()}`;
}

async function loadSummary(sessionId = adminSessionId){
  const data = await apiRequest('/api/admin/schools?summary=1');
  if(!adminToken || sessionId !== adminSessionId) return null;
  renderSummary(data);
  knownSchoolTotal = Number(data?.status_counts?.all || 0);
  return knownSchoolTotal;
}

async function loadSchools(sessionId = adminSessionId){
  let data = await apiRequest(buildSchoolsUrl());
  if(!adminToken || sessionId !== adminSessionId) return;
  const availablePages = Math.max(1, Number(data?.pagination?.pages || 1));

  if(currentPage > availablePages){
    currentPage = availablePages;
    data = await apiRequest(buildSchoolsUrl());
    if(!adminToken || sessionId !== adminSessionId) return;
  }

  renderSchools(data);
}

async function loadAuditLogs({ optional = false, sessionId = adminSessionId } = {}){
  try{
    const data = await apiRequest('/api/admin/audit-logs?limit=50');
    if(!adminToken || sessionId !== adminSessionId) return false;
    renderAuditLogs(data);
    return true;
  }catch(error){
    if(!adminToken || sessionId !== adminSessionId) return false;
    auditTableBody.replaceChildren();
    auditEmptyState.hidden = false;
    const message = auditEmptyState.querySelector('span');
    if(message) message.textContent = 'تعذر تحميل سجل العمليات مؤقتًا. يمكن إعادة المحاولة لاحقًا.';
    if(!optional) throw error;
    return false;
  }
}

async function refreshAll(
  successMessage = 'تم تحديث بيانات المدارس.',
  { automatic = false } = {}
){
  if(!adminToken || busy || refreshInFlightSession === adminSessionId) return false;

  const previousTotal = knownSchoolTotal;
  const sessionId = adminSessionId;
  refreshInFlightSession = sessionId;

  if(!automatic){
    setBusy(true);
    setStatus('جارٍ تحميل بيانات المدارس...');
  }

  try{
    const [newTotal] = await Promise.all([loadSummary(sessionId), loadSchools(sessionId)]);
    if(!adminToken || sessionId !== adminSessionId) return false;
    if(!automatic) await loadAuditLogs({ optional: true, sessionId });
    if(!adminToken || sessionId !== adminSessionId) return false;
    setAdminVisible(true);

    if(automatic){
      if(previousTotal !== null && newTotal > previousTotal){
        setStatus('تمت إضافة مدرسة جديدة إلى القائمة.', 'success');
      }
    }else{
      setStatus(successMessage, 'success');
    }

    return true;
  }catch(error){
    if(adminToken && !automatic){
      setStatus(error instanceof Error ? error.message : 'تعذر تحميل البيانات.', 'error');
    }
    return false;
  }finally{
    if(refreshInFlightSession === sessionId) refreshInFlightSession = 0;
    if(!automatic) setBusy(false);
  }
}

function requestAutomaticRefresh(){
  if(!adminToken || document.visibilityState !== 'visible') return;

  const now = Date.now();
  if(now - lastAutomaticRefreshAt < automaticRefreshCooldownMs) return;

  lastAutomaticRefreshAt = now;
  refreshAll('', { automatic: true });
}

function stopAutoRefresh(){
  if(!autoRefreshTimer) return;
  window.clearInterval(autoRefreshTimer);
  autoRefreshTimer = 0;
}

function startAutoRefresh(){
  stopAutoRefresh();
  if(!adminToken) return;

  lastAutomaticRefreshAt = Date.now();
  autoRefreshTimer = window.setInterval(
    requestAutomaticRefresh,
    autoRefreshIntervalMs
  );
}

function handleVisibilityChange(){
  if(document.visibilityState === 'visible') requestAutomaticRefresh();
}

async function connect(){
  const token = adminTokenInput.value.trim();
  if(!token){
    setStatus('أدخل رمز الإدارة أولًا.', 'error');
    adminTokenInput.focus();
    return;
  }

  adminToken = token;
  adminSessionId += 1;
  currentPage = 1;
  const connected = await refreshAll('تم الدخول وتحميل المدارس المسجلة.');
  if(connected && adminToken) startAutoRefresh();
}

async function updateSchoolStatus(school, status){
  if(busy) return;
  const label = statusLabels[status] || status;

  setBusy(true);
  setStatus(`جارٍ تحديث حالة ${school.school_name}...`);
  try{
    await apiRequest(`/api/admin/schools/${school.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verificationStatus: status })
    });
    await Promise.all([loadSummary(), loadSchools(), loadAuditLogs({ optional: true })]);
    setStatus(`تم تحديث حالة المدرسة إلى «${label}».`, 'success');
  }catch(error){
    if(adminToken){
      setStatus(error instanceof Error ? error.message : 'تعذر تحديث حالة المدرسة.', 'error');
    }
  }finally{
    setBusy(false);
  }
}

function closeDeleteDialog(){
  pendingDeleteSchool = null;
  deleteConfirmationInput.value = '';
  confirmDeleteBtn.disabled = true;
  if(deleteSchoolDialog.open) deleteSchoolDialog.close();
}

function requestSchoolDeletion(school){
  if(busy) return;
  pendingDeleteSchool = school;
  deleteSchoolName.textContent = school.school_name || '—';
  deleteSchoolStage.textContent = school.school_stage || '—';
  deleteSchoolDepartment.textContent = school.education_department || '—';
  deleteConfirmationInput.value = '';
  confirmDeleteBtn.disabled = true;
  deleteSchoolDialog.showModal();
  deleteConfirmationInput.focus();
}

async function deleteSchool(school){
  if(busy || !school) return;

  setBusy(true);
  setStatus(`جارٍ حذف سجل ${school.school_name}...`);
  try{
    await apiRequest(`/api/admin/schools/${school.id}`, { method: 'DELETE' });
    const remainingOnPage = schoolsTableBody.children.length - 1;
    if(remainingOnPage === 0 && currentPage > 1) currentPage -= 1;
    await Promise.all([loadSummary(), loadSchools(), loadAuditLogs({ optional: true })]);
    setStatus('تم حذف سجل المدرسة.', 'success');
  }catch(error){
    if(adminToken){
      setStatus(error instanceof Error ? error.message : 'تعذر حذف سجل المدرسة.', 'error');
    }
  }finally{
    setBusy(false);
  }
}

function resetAndReload(){
  currentPage = 1;
  refreshAll();
}

connectBtn.addEventListener('click', connect);
logoutBtn.addEventListener('click', () => resetSession());
refreshBtn.addEventListener('click', () => refreshAll());
auditRefreshBtn.addEventListener('click', async () => {
  if(busy || !adminToken) return;
  setBusy(true);
  setStatus('جارٍ تحديث سجل العمليات...');
  try{
    await loadAuditLogs();
    setStatus('تم تحديث سجل العمليات.', 'success');
  }catch(error){
    if(adminToken){
      setStatus(error instanceof Error ? error.message : 'تعذر تحديث سجل العمليات.', 'error');
    }
  }finally{
    setBusy(false);
  }
});
adminTokenInput.addEventListener('keydown', (event) => {
  if(event.key === 'Enter') connect();
});

searchInput.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(resetAndReload, 350);
});
stageFilter.addEventListener('change', resetAndReload);
statusFilter.addEventListener('change', resetAndReload);
sortSelect.addEventListener('change', resetAndReload);
previousPageBtn.addEventListener('click', () => {
  if(currentPage <= 1 || busy) return;
  currentPage -= 1;
  refreshAll();
});
nextPageBtn.addEventListener('click', () => {
  if(currentPage >= totalPages || busy) return;
  currentPage += 1;
  refreshAll();
});

deleteConfirmationInput.addEventListener('input', () => {
  confirmDeleteBtn.disabled = deleteConfirmationInput.value.trim() !== 'حذف';
});
cancelDeleteBtn.addEventListener('click', closeDeleteDialog);
deleteSchoolDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeDeleteDialog();
});
deleteSchoolForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if(deleteConfirmationInput.value.trim() !== 'حذف' || !pendingDeleteSchool) return;
  const school = pendingDeleteSchool;
  closeDeleteDialog();
  await deleteSchool(school);
});

window.addEventListener('focus', requestAutomaticRefresh);
document.addEventListener('visibilitychange', handleVisibilityChange);

window.addEventListener('pagehide', () => {
  stopAutoRefresh();
  adminToken = '';
  adminTokenInput.value = '';
});

setAdminVisible(false);
resetCounts();
updatePagination();
