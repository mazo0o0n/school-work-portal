const nameInput = document.getElementById('schoolName');
const stageSelect = document.getElementById('schoolStage');
const preview = document.getElementById('schoolPreview');
const nameError = document.getElementById('schoolNameError');
const englishLettersPattern = /[A-Za-z]/;

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

nameInput.value = removeEnglishLetters(localStorage.getItem('registeredSchoolBaseName') || '');
stageSelect.value = localStorage.getItem('registeredSchoolStage') || '';
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
  localStorage.setItem('schoolGuestMode', '1');
  window.location.href = 'index.html';
});

document.getElementById('schoolRegisterForm').addEventListener('submit', event => {
  event.preventDefault();
  const name = nameInput.value.trim();
  const stage = stageSelect.value.trim();
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
  localStorage.removeItem('schoolGuestMode');
  localStorage.setItem('registeredSchoolBaseName', name);
  localStorage.setItem('registeredSchoolStage', stage);
  localStorage.setItem('registeredSchoolName', displayName);
  window.location.href = 'index.html';
});
