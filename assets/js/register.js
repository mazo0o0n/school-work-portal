const nameInput = document.getElementById('schoolName');
const stageSelect = document.getElementById('schoolStage');
const preview = document.getElementById('schoolPreview');
const nameError = document.getElementById('schoolNameError');
const educationDepartmentInput = document.getElementById('educationDepartment');
const englishLettersPattern = /[A-Za-z]/;
const schoolProfileStorageKey = 'registeredSchoolProfile';

function getDisplayName(){
  const name = nameInput.value.trim();
  const stage = stageSelect.value.trim();
  return name && stage ? `${stage} ${name}` : '';
}

function updatePreview(){
  preview.textContent = getDisplayName() || 'سيظهر الاسم في الهيدر هنا';
}

function setNameError(message = ''){
  nameError.textContent = message;
  nameInput.classList.toggle('input-error', Boolean(message));
}

function removeEnglishLetters(value){
  return value.replace(/[A-Za-z]/g, '');
}

function getStoredSchoolProfile(){
  try{
    const profile = JSON.parse(localStorage.getItem(schoolProfileStorageKey) || '{}');
    return profile && typeof profile === 'object' && !Array.isArray(profile) ? profile : {};
  }catch(_){
    return {};
  }
}

function validateArabicSchoolName(){
  if(englishLettersPattern.test(nameInput.value)){
    nameInput.value = removeEnglishLetters(nameInput.value);
    setNameError('اسم المدرسة يجب أن يكون باللغة العربية فقط، ولا يسمح بالحروف الإنجليزية.');
    updatePreview();
    return false;
  }
  setNameError('');
  return true;
}

const storedSchoolProfile = getStoredSchoolProfile();
nameInput.value = removeEnglishLetters(localStorage.getItem('registeredSchoolBaseName') || storedSchoolProfile.schoolName || '');
stageSelect.value = localStorage.getItem('registeredSchoolStage') || storedSchoolProfile.schoolStage || storedSchoolProfile.stage || '';
educationDepartmentInput.value = String(storedSchoolProfile.educationDepartment || '');
updatePreview();

nameInput.addEventListener('beforeinput', (event) => {
  if(event.data && englishLettersPattern.test(event.data)){
    event.preventDefault();
    setNameError('ممنوع استخدام الحروف الإنجليزية في اسم المدرسة.');
  }
});

nameInput.addEventListener('input', () => {
  validateArabicSchoolName();
  updatePreview();
});

nameInput.addEventListener('paste', () => {
  requestAnimationFrame(validateArabicSchoolName);
});

stageSelect.addEventListener('change', updatePreview);

document.getElementById('guestEntry').addEventListener('click', () => {
  localStorage.removeItem('registeredSchoolBaseName');
  localStorage.removeItem('registeredSchoolStage');
  localStorage.removeItem('registeredSchoolName');
  localStorage.removeItem(schoolProfileStorageKey);
  localStorage.setItem('schoolGuestMode', '1');
  window.location.href = 'index.html';
});

document.getElementById('schoolRegisterForm').addEventListener('submit', event => {
  event.preventDefault();
  const name = nameInput.value.trim();
  const stage = stageSelect.value.trim();
  const educationDepartment = educationDepartmentInput.value.trim();
  const displayName = getDisplayName();
  if(!name){
    nameInput.focus();
    return;
  }
  if(!validateArabicSchoolName()){
    nameInput.focus();
    return;
  }
  if(!stage){
    stageSelect.focus();
    return;
  }
  if(!educationDepartment){
    educationDepartmentInput.focus();
    return;
  }
  localStorage.removeItem('schoolGuestMode');
  localStorage.setItem('registeredSchoolBaseName', name);
  localStorage.setItem('registeredSchoolStage', stage);
  localStorage.setItem('registeredSchoolName', displayName);
  localStorage.setItem(schoolProfileStorageKey, JSON.stringify({
    schoolName: name,
    schoolStage: stage,
    stage,
    educationDepartment
  }));
  window.location.href = 'index.html';
});
