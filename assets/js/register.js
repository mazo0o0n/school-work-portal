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
  }catch{
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

document
  .getElementById('schoolRegisterForm')
  .addEventListener('submit', async event => {
    event.preventDefault();

    const name = nameInput.value.trim();
    const stage = stageSelect.value.trim();
    const educationDepartment = educationDepartmentInput.value.trim();
    const displayName = getDisplayName();

    if (!name) {
      nameInput.focus();
      return;
    }

    if (!validateArabicSchoolName()) {
      nameInput.focus();
      return;
    }

    if (!stage) {
      stageSelect.focus();
      return;
    }

    if (!educationDepartment) {
      educationDepartmentInput.focus();
      return;
    }

    const submitButton =
      event.submitter ||
      event.currentTarget.querySelector('button[type="submit"]');

    const originalButtonText = submitButton?.textContent || '';

    try {
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'جارٍ تسجيل المدرسة...';
      }

      const response = await fetch('/api/schools/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          schoolName: name,
          schoolStage: stage,
          educationDepartment
        })
      });

      const responseText = await response.text();

      let result = {};

      try {
        result = responseText ? JSON.parse(responseText) : {};
      } catch {
        result = {};
      }

      if (
        !response.ok ||
        !result.ok ||
        !result.school?.publicId ||
        !result.editToken
      ) {
        const message =
          result.error === 'Too many requests'
            ? 'تم تجاوز عدد محاولات التسجيل المسموح بها. حاول بعد قليل.'
            : result.error || 'تعذر تسجيل المدرسة حاليًا. حاول مرة أخرى.';

        throw new Error(message);
      }

      localStorage.removeItem('schoolGuestMode');

      localStorage.setItem('registeredSchoolBaseName', name);
      localStorage.setItem('registeredSchoolStage', stage);
      localStorage.setItem('registeredSchoolName', displayName);

      localStorage.setItem(
        'registeredSchoolPublicId',
        result.school.publicId
      );

      localStorage.setItem(
        'registeredSchoolEditToken',
        result.editToken
      );

      localStorage.setItem(
        schoolProfileStorageKey,
        JSON.stringify({
          publicId: result.school.publicId,
          schoolName: name,
          schoolStage: stage,
          educationDepartment,
          verificationStatus:
            result.school.verificationStatus || 'unverified'
        })
      );

      window.location.href = 'index.html';
    } catch (error) {
      console.error('School registration failed:', error);

      alert(
        error instanceof Error
          ? error.message
          : 'تعذر تسجيل المدرسة حاليًا. حاول مرة أخرى.'
      );
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
      }
    }
  });