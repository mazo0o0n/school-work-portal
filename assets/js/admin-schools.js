const adminTokenInput = document.getElementById('adminToken');
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

let adminToken = '';
let currentPage = 1;
let totalPages = 1;
let busy = false;
let searchTimer = 0;
const pageSize = 25;

function setStatus(message, type = ''){
  statusLine.textContent = message;
  statusLine.className = `status-line ${type}`.trim();
}

function setAdminVisible(value){
  adminContent.forEach((element) => {
    element.hidden = !value;
  });
  logoutBtn.hidden = !value;
  connectBtn.hidden = value;
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
  adminToken = '';
  adminTokenInput.value = '';
  currentPage = 1;
  totalPages = 1;
  schoolsTableBody.replaceChildren();
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

  let body = {};
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

  deleteButton.addEventListener('click', async () => {
    await deleteSchool(school);
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

async function loadSummary(){
  const data = await apiRequest('/api/admin/schools?summary=1');
  renderSummary(data);
}

async function loadSchools(){
  const data = await apiRequest(buildSchoolsUrl());
  renderSchools(data);
}

async function refreshAll(successMessage = 'تم تحديث بيانات المدارس.'){
  if(!adminToken || busy) return;

  setBusy(true);
  setStatus('جارٍ تحميل بيانات المدارس...');
  try{
    await Promise.all([loadSummary(), loadSchools()]);
    setAdminVisible(true);
    setStatus(successMessage, 'success');
  }catch(error){
    if(adminToken){
      setStatus(error instanceof Error ? error.message : 'تعذر تحميل البيانات.', 'error');
    }
  }finally{
    setBusy(false);
  }
}

async function connect(){
  const token = adminTokenInput.value.trim();
  if(!token){
    setStatus('أدخل رمز الإدارة أولًا.', 'error');
    adminTokenInput.focus();
    return;
  }

  adminToken = token;
  currentPage = 1;
  await refreshAll('تم الدخول وتحميل المدارس المسجلة.');
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
    await Promise.all([loadSummary(), loadSchools()]);
    setStatus(`تم تحديث حالة المدرسة إلى «${label}».`, 'success');
  }catch(error){
    if(adminToken){
      setStatus(error instanceof Error ? error.message : 'تعذر تحديث حالة المدرسة.', 'error');
    }
  }finally{
    setBusy(false);
  }
}

async function deleteSchool(school){
  if(busy) return;
  const confirmed = window.confirm(
    `سيتم حذف سجل «${school.school_name}» نهائيًا من قاعدة البيانات. هل تريد المتابعة؟`
  );
  if(!confirmed) return;

  setBusy(true);
  setStatus(`جارٍ حذف سجل ${school.school_name}...`);
  try{
    await apiRequest(`/api/admin/schools/${school.id}`, { method: 'DELETE' });
    const remainingOnPage = schoolsTableBody.children.length - 1;
    if(remainingOnPage === 0 && currentPage > 1) currentPage -= 1;
    await Promise.all([loadSummary(), loadSchools()]);
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

window.addEventListener('pagehide', () => {
  adminToken = '';
  adminTokenInput.value = '';
});

setAdminVisible(false);
resetCounts();
updatePagination();
