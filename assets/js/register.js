const nameInput = document.getElementById('schoolName');
const stageSelect = document.getElementById('schoolStage');
const preview = document.getElementById('schoolPreview');
const nameError = document.getElementById('schoolNameError');
const educationDepartmentInput = document.getElementById('educationDepartment');
const schoolRegisterForm = document.getElementById('schoolRegisterForm');
const contactNameInput = document.getElementById('registrationContactName');
const contactPhoneInput = document.getElementById('registrationContactPhone');
const contactPhoneError = document.getElementById('registrationContactPhoneError');
const registrationConsent = document.getElementById('registrationConsent');
const englishLettersPattern = /[A-Za-z]/;
const schoolProfileStorageKey = 'registeredSchoolProfile';
const duplicateSchoolMessage =
  'هذه المدرسة مسجلة مسبقًا بنفس المرحلة وإدارة التعليم.';

function readStorage(key){
  try{
    return localStorage.getItem(key) || '';
  }catch{
    return '';
  }
}

function applyPreferredTheme(){
  if(readStorage('preferredTheme') === 'dark'){
    document.documentElement.dataset.theme = 'dark';
  }
}

function getStoredSchoolProfile(){
  try{
    const profile = JSON.parse(readStorage(schoolProfileStorageKey) || '{}');
    return profile && typeof profile === 'object' && !Array.isArray(profile) ? profile : {};
  }catch{
    return {};
  }
}

function enterAsGuest(){
  localStorage.removeItem('registeredSchoolBaseName');
  localStorage.removeItem('registeredSchoolStage');
  localStorage.removeItem('registeredSchoolName');
  localStorage.removeItem(schoolProfileStorageKey);
  localStorage.setItem('schoolGuestMode', '1');
  window.location.href = 'index.html';
}

function bindGuestEntry(buttonId){
  document.getElementById(buttonId)?.addEventListener('click', enterAsGuest);
}

function removeEnglishLetters(value){
  return value.replace(/[A-Za-z]/g, '');
}

function normalizeDigits(value){
  return String(value || '')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function normalizeSaudiMobile(value){
  const compact = normalizeDigits(value).replace(/[\s().-]/g, '');
  if(/^05\d{8}$/.test(compact)){
    return `+966${compact.slice(1)}`;
  }
  if(/^9665\d{8}$/.test(compact)){
    return `+${compact}`;
  }
  if(/^\+9665\d{8}$/.test(compact)){
    return compact;
  }
  return '';
}

function setContactPhoneError(message = ''){
  if(!contactPhoneInput || !contactPhoneError){
    return;
  }
  contactPhoneError.textContent = message;
  contactPhoneInput.classList.toggle('input-error', Boolean(message));
  contactPhoneInput.setAttribute('aria-invalid', String(Boolean(message)));
}

function validateContactPhone(){
  if(!contactPhoneInput){
    return '';
  }
  const normalizedPhone = normalizeSaudiMobile(contactPhoneInput.value);
  if(!normalizedPhone){
    setContactPhoneError('أدخل رقم جوال سعودي صحيحًا مثل 05xxxxxxxx أو +9665xxxxxxxx.');
    return '';
  }
  setContactPhoneError('');
  return normalizedPhone;
}

function getDisplayName(){
  const name = nameInput?.value.trim() || '';
  const stage = stageSelect?.value.trim() || '';
  return name && stage ? `${stage} ${name}` : '';
}

function updatePreview(){
  if(preview){
    preview.textContent = getDisplayName() || 'سيظهر الاسم في الهيدر هنا';
  }
}

function setNameError(message = ''){
  if(!nameError || !nameInput){
    return;
  }
  nameError.textContent = message;
  nameInput.classList.toggle('input-error', Boolean(message));
}

function validateArabicSchoolName(){
  if(!nameInput){
    return true;
  }
  if(englishLettersPattern.test(nameInput.value)){
    nameInput.value = removeEnglishLetters(nameInput.value);
    setNameError('اسم المدرسة يجب أن يكون باللغة العربية فقط، ولا يسمح بالحروف الإنجليزية.');
    updatePreview();
    return false;
  }
  setNameError('');
  return true;
}

function setupRegistrationForm(){
  if(
    !schoolRegisterForm ||
    !nameInput ||
    !stageSelect ||
    !educationDepartmentInput ||
    !contactNameInput ||
    !contactPhoneInput ||
    !registrationConsent
  ){
    return;
  }

  const storedSchoolProfile = getStoredSchoolProfile();
  const isNewSchool = new URLSearchParams(window.location.search).get('new') === '1';
  if(!isNewSchool){
    nameInput.value = removeEnglishLetters(
      readStorage('registeredSchoolBaseName') || storedSchoolProfile.schoolName || ''
    );
    stageSelect.value =
      readStorage('registeredSchoolStage') ||
      storedSchoolProfile.schoolStage ||
      storedSchoolProfile.stage ||
      '';
    educationDepartmentInput.value = String(
      storedSchoolProfile.educationDepartment || ''
    );
  }
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

  contactPhoneInput.addEventListener('input', () => {
    if(contactPhoneError?.textContent){
      validateContactPhone();
    }
  });
  contactPhoneInput.addEventListener('blur', validateContactPhone);

  schoolRegisterForm.addEventListener('submit', async event => {
    event.preventDefault();

    const name = nameInput.value.trim();
    const stage = stageSelect.value.trim();
    const educationDepartment = educationDepartmentInput.value.trim();
    const registrationContactName = contactNameInput.value.trim().replace(/\s+/g, ' ');
    const registrationContactPhone = validateContactPhone();
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

    if (!registrationContactPhone) {
      contactPhoneInput.focus();
      return;
    }

    if (!registrationConsent.checked) {
      registrationConsent.focus();
      registrationConsent.reportValidity();
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
          educationDepartment,
          registrationContactName,
          registrationContactPhone,
          registrationContactConsent: true
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
          result.code === 'duplicate_school'
            ? duplicateSchoolMessage
            : result.error === 'Too many requests'
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
}

function setOptionalText(rowId, valueId, value){
  const row = document.getElementById(rowId);
  const target = document.getElementById(valueId);
  if(!row || !target){
    return;
  }
  const text = String(value || '').trim();
  row.hidden = !text;
  target.textContent = text;
}

function setupLoginPage(){
  const storedState = document.getElementById('storedSchoolState');
  const emptyState = document.getElementById('emptySchoolState');
  if(!storedState || !emptyState){
    return;
  }

  const profile = getStoredSchoolProfile();
  const baseName = String(
    readStorage('registeredSchoolBaseName') || profile.schoolName || ''
  ).trim();
  const stage = String(
    readStorage('registeredSchoolStage') ||
    profile.schoolStage ||
    profile.stage ||
    ''
  ).trim();
  const storedDisplayName = readStorage('registeredSchoolName').trim();
  const displayName = storedDisplayName ||
    (baseName && stage ? `${stage} ${baseName}` : baseName);
  const educationDepartment = String(profile.educationDepartment || '').trim();
  const hasStoredSchool = Boolean(displayName || profile.publicId);

  storedState.hidden = !hasStoredSchool;
  emptyState.hidden = hasStoredSchool;

  if(hasStoredSchool){
    const schoolNameTarget = document.getElementById('storedSchoolName');
    if(schoolNameTarget){
      schoolNameTarget.textContent = displayName || 'مدرسة محفوظة';
    }
    setOptionalText('storedSchoolStageRow', 'storedSchoolStage', stage);
    setOptionalText(
      'storedSchoolDepartmentRow',
      'storedSchoolDepartment',
      educationDepartment
    );
  }

  document.getElementById('enterRegisteredSchool')?.addEventListener('click', () => {
    localStorage.removeItem('schoolGuestMode');
    window.location.href = 'index.html';
  });
}

applyPreferredTheme();
bindGuestEntry('guestEntry');
bindGuestEntry('emptyGuestEntry');
setupRegistrationForm();
setupLoginPage();
