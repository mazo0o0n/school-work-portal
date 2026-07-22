(function(){
  'use strict';

  const managerReportsDataPath = 'assets/data/manager-reports.json';
  let managerReportTemplates = [];

  const reportFields = [
    'schoolName',
    'schoolStage',
    'educationDepartment',
    'educationDepartmentPrefix',
    'educationDepartmentName',
    'ministryNumber',
    'principalName',
    'educationalAffairsAgent',
    'studentAffairsAgent',
    'schoolAffairsAgent',
    'activityLeaderName',
    'signatureRightRole',
    'signatureRightName',
    'signatureLeftRole',
    'signatureLeftName'
  ];

  const reportFieldLabels = {
    educationDepartment:'إدارة التعليم',
    schoolDisplayName:'اسم المدرسة',
    principalName:'مدير المدرسة',
    educationalAffairsAgent:'وكيل الشؤون التعليمية',
    studentAffairsAgent:'وكيل شؤون الطلاب',
    schoolAffairsAgent:'وكيل الشؤون المدرسية',
    activityLeaderName:'رائد النشاط',
    ministryNumber:'الرقم الوزاري'
  };

  const library = document.getElementById('managerReportLibrary');
  const grid = document.getElementById('managerReportGrid');
  const search = document.getElementById('managerReportSearch');
  const empty = document.getElementById('managerReportEmpty');
  const categoryButtons = Array.from(document.querySelectorAll('[data-report-category]'));
  if(!library || !grid || !search || !empty || !categoryButtons.length) return;
  const managerReportsModal = library.closest('#managerReportsModal');

  const customDataStorageKey = 'reportCustomData';
  let activeCategory = 'الكل';
  let lastRenderKey = '';
  let renderFrame = 0;
  let customizationModal = null;
  let customizationFields = null;
  let customizationTitle = null;
  let customizationStatus = null;
  let activeCustomReport = null;
  let customizationReturnFocus = null;
  let reportDependenciesPromise = null;
  const reportDependencySources = [
    {
      src:'assets/vendor/docxtemplater-3.69.0.js',
      isReady:()=>typeof window.docxtemplater === 'function'
    },
    {
      src:'assets/vendor/pizzip-3.2.0.min.js',
      isReady:()=>typeof window.PizZip === 'function'
    }
  ];
  const reportSearchText = new Map();

  function rebuildReportSearchText(){
    reportSearchText.clear();
    managerReportTemplates.forEach(report=>{
      reportSearchText.set(
        report.id,
        normalizeSearch(`${report.title} ${report.description} ${report.category} ${(report.tags || []).join(' ')}`)
      );
    });
  }

  async function loadManagerReportTemplates(){
    try{
      const response = await fetch(managerReportsDataPath, {cache:'no-store'});
      if(!response.ok) throw new Error('تعذر تحميل بيانات تقارير المدير.');
      const reports = await response.json();
      if(!Array.isArray(reports)) throw new Error('بيانات تقارير المدير غير صالحة.');
      managerReportTemplates = reports;
      rebuildReportSearchText();
      lastRenderKey = '';
      renderManagerReportLibrary();
      return true;
    }catch{
      managerReportTemplates = [];
      reportSearchText.clear();
      grid.replaceChildren();
      empty.textContent = 'تعذر تحميل مكتبة التقارير. أعد تحميل الصفحة وحاول مرة أخرى.';
      empty.hidden = false;
      return false;
    }
  }

  const managerReportsReady = loadManagerReportTemplates();

  function createSchoolDisplayName(stage, schoolName){
    return [stage, schoolName]
      .map(value=>String(value || '').trim())
      .filter(Boolean)
      .join(' ');
  }

  function loadReportDependency(dependency){
    if(dependency.isReady()) return Promise.resolve();

    return new Promise((resolve, reject)=>{
      const existing = document.querySelector(`script[data-report-dependency="${dependency.src}"]`);
      const script = existing || document.createElement('script');
      const onLoad = ()=>{
        if(dependency.isReady()){
          resolve();
        }else{
          reject(new Error('تعذر تحميل مكونات إنشاء ملف Word.'));
        }
      };
      const onError = ()=>reject(new Error('تعذر تحميل مكونات إنشاء ملف Word.'));

      script.addEventListener('load', onLoad, {once:true});
      script.addEventListener('error', onError, {once:true});
      if(existing) return;

      script.src = dependency.src;
      script.dataset.reportDependency = dependency.src;
      document.head.appendChild(script);
    });
  }

  function loadReportDependencies(){
    if(reportDependencySources.every(dependency=>dependency.isReady())){
      return Promise.resolve();
    }
    if(reportDependenciesPromise) return reportDependenciesPromise;

    reportDependenciesPromise = reportDependencySources
      .reduce(
        (chain, dependency)=>chain.then(()=>loadReportDependency(dependency)),
        Promise.resolve()
      )
      .catch(error=>{
        reportDependenciesPromise = null;
        throw error;
      });
    return reportDependenciesPromise;
  }

  function readReportCustomStore(){
    try{
      const parsed = JSON.parse(localStorage.getItem(customDataStorageKey) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }catch{
      localStorage.removeItem(customDataStorageKey);
      return {};
    }
  }

  function getReportCustomData(report){
    if(!Array.isArray(report.customFields) || !report.customFields.length) return {};
    const storedReportData = readReportCustomStore()[report.id];
    const source = storedReportData && typeof storedReportData === 'object' && !Array.isArray(storedReportData)
      ? storedReportData
      : {};
    return report.customFields.reduce((result, field)=>{
      const value = source[field.key];
      result[field.key] = value === null || value === undefined ? '' : String(value).trim();
      return result;
    }, {});
  }

  function getCleanReportData(report){
    const source = typeof window.getReportMergeData === 'function'
      ? window.getReportMergeData(report.sectionId)
      : {};
    const data = reportFields.reduce((result, key)=>{
      const value = source && source[key] !== null && source[key] !== undefined
        ? String(source[key]).trim()
        : '';
      result[key] = value;
      return result;
    }, {});
    data.schoolDisplayName = createSchoolDisplayName(data.schoolStage, data.schoolName);
    data.schoolName = data.schoolDisplayName;
    return {
      ...data,
      ...getReportCustomData(report)
    };
  }

  function createElement(tagName, className = '', text = ''){
    const element = document.createElement(tagName);
    if(className) element.className = className;
    if(text) element.textContent = text;
    return element;
  }

  function closeCustomizationModal(restoreFocus = true){
    if(!customizationModal || customizationModal.hidden) return;
    customizationModal.hidden = true;
    activeCustomReport = null;
    if(restoreFocus && customizationReturnFocus && document.contains(customizationReturnFocus)){
      customizationReturnFocus.focus();
    }
    customizationReturnFocus = null;
  }

  function setCustomizationStatus(message, isError = false){
    if(!customizationStatus) return;
    customizationStatus.textContent = message;
    customizationStatus.classList.toggle('is-error', isError);
  }

  function populateCustomizationFields(report){
    if(!customizationFields) return;
    const values = getReportCustomData(report);
    const fragment = document.createDocumentFragment();
    report.customFields.forEach(field=>{
      const wrapper = createElement('label', 'report-custom-field');
      const labelText = createElement('span', '', field.label);
      const input = document.createElement('input');
      input.type = field.type || 'text';
      input.value = values[field.key] || '';
      input.placeholder = field.placeholder || '';
      input.autocomplete = 'off';
      input.dataset.reportCustomField = field.key;
      wrapper.append(labelText, input);
      fragment.appendChild(wrapper);
    });
    customizationFields.replaceChildren(fragment);
  }

  function ensureCustomizationModal(){
    if(customizationModal) return;

    customizationModal = createElement('div', 'report-custom-modal');
    customizationModal.hidden = true;

    const dialog = createElement('div', 'report-custom-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'reportCustomizationTitle');
    dialog.setAttribute('aria-describedby', 'reportCustomizationDescription');

    const header = createElement('header', 'report-custom-head');
    const headingGroup = document.createElement('div');
    customizationTitle = createElement('h2', '', 'تخصيص التقرير');
    customizationTitle.id = 'reportCustomizationTitle';
    const description = createElement(
      'p',
      '',
      'هذه البيانات خاصة بهذا التقرير فقط، ويمكن ترك أي حقل فارغًا.'
    );
    description.id = 'reportCustomizationDescription';
    headingGroup.append(customizationTitle, description);

    const closeButton = createElement('button', 'report-custom-close');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'إغلاق تخصيص التقرير');
    const closeIcon = createElement('i', 'fa-solid fa-xmark');
    closeIcon.setAttribute('aria-hidden', 'true');
    closeButton.appendChild(closeIcon);
    header.append(headingGroup, closeButton);

    customizationFields = createElement('div', 'report-custom-fields');

    const actions = createElement('footer', 'report-custom-actions');
    const saveButton = createElement('button', 'report-custom-save', 'حفظ');
    saveButton.type = 'button';
    const cancelButton = createElement('button', 'report-custom-cancel', 'إلغاء');
    cancelButton.type = 'button';
    const clearButton = createElement('button', 'report-custom-clear', 'مسح تخصيص هذا التقرير');
    clearButton.type = 'button';
    customizationStatus = createElement('p', 'report-custom-status');
    customizationStatus.setAttribute('role', 'status');
    customizationStatus.setAttribute('aria-live', 'polite');
    actions.append(saveButton, cancelButton, clearButton, customizationStatus);

    dialog.append(header, customizationFields, actions);
    customizationModal.appendChild(dialog);
    (managerReportsModal || document.body).appendChild(customizationModal);

    closeButton.addEventListener('click', closeCustomizationModal);
    cancelButton.addEventListener('click', closeCustomizationModal);
    customizationModal.addEventListener('click', event=>{
      if(event.target === customizationModal) closeCustomizationModal();
    });

    clearButton.addEventListener('click', ()=>{
      if(!activeCustomReport) return;
      try{
        const store = readReportCustomStore();
        delete store[activeCustomReport.id];
        localStorage.setItem(customDataStorageKey, JSON.stringify(store));
        populateCustomizationFields(activeCustomReport);
        setCustomizationStatus('تم مسح تخصيص هذا التقرير.');
      }catch{
        setCustomizationStatus('تعذر مسح بيانات التخصيص.', true);
      }
    });

    saveButton.addEventListener('click', ()=>{
      if(!activeCustomReport) return;
      const values = {};
      activeCustomReport.customFields.forEach(field=>{
        const input = customizationFields.querySelector(
          `[data-report-custom-field="${field.key}"]`
        );
        values[field.key] = input ? input.value.trim() : '';
      });
      try{
        const store = readReportCustomStore();
        store[activeCustomReport.id] = values;
        localStorage.setItem(customDataStorageKey, JSON.stringify(store));
        setCustomizationStatus('تم حفظ تخصيص التقرير.');
        window.setTimeout(closeCustomizationModal, 450);
      }catch{
        setCustomizationStatus('تعذر حفظ بيانات التخصيص.', true);
      }
    });

    customizationModal.addEventListener('keydown', event=>{
      if(event.key === 'Escape'){
        event.stopPropagation();
        closeCustomizationModal();
        return;
      }
      if(event.key !== 'Tab') return;
      const focusable = Array.from(
        dialog.querySelectorAll('button:not([disabled]), input:not([disabled])')
      ).filter(element=>!element.hidden);
      if(!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if(event.shiftKey && document.activeElement === first){
        event.preventDefault();
        last.focus();
      }else if(!event.shiftKey && document.activeElement === last){
        event.preventDefault();
        first.focus();
      }
    });
  }

  function openCustomizationModal(report, trigger){
    if(!Array.isArray(report.customFields) || !report.customFields.length) return;
    ensureCustomizationModal();
    activeCustomReport = report;
    customizationReturnFocus = trigger;
    customizationTitle.textContent = `تخصيص التقرير: ${report.title}`;
    setCustomizationStatus('');
    populateCustomizationFields(report);
    customizationModal.hidden = false;
    customizationFields.querySelector('input')?.focus();
  }

  managerReportsModal?.addEventListener('manager-reports:close', ()=>{
    closeCustomizationModal(false);
  });

  function createDownloadName(report, data){
    const schoolDisplayName = data.schoolDisplayName.trim();
    let fileName = String(report.outputFileName || `${report.title}.docx`);
    if(schoolDisplayName){
      fileName = fileName.replace(/\{\{schoolDisplayName\}\}/g, schoolDisplayName);
    }else{
      fileName = fileName
        .replace(/\s*-\s*\{\{schoolDisplayName\}\}/g, '')
        .replace(/\{\{schoolDisplayName\}\}/g, '');
    }
    fileName = fileName.replace(/\s+\.docx$/i, '.docx').trim();
    if(!fileName.toLowerCase().endsWith('.docx')) fileName += '.docx';
    return fileName.replace(/[\\/:*?"<>|]/g, '-');
  }

  function downloadBlob(blob, fileName){
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(objectUrl), 1000);
  }

  function setStatus(status, message, isError = false){
    if(!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }

  async function generateManagerReport(report, button, status){
    if(button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    setStatus(status, 'جاري تجهيز ملف Word...');

    try{
      await loadReportDependencies();
      if(typeof window.PizZip !== 'function' || typeof window.docxtemplater !== 'function'){
        throw new Error('تعذر تحميل مكونات إنشاء ملف Word.');
      }

      const response = await fetch(report.templatePath, {cache:'no-store'});
      if(!response.ok){
        throw new Error('تعذر تحميل قالب التقرير.');
      }

      const templateContent = await response.arrayBuffer();
      const zip = new window.PizZip(templateContent);
      const documentTemplate = new window.docxtemplater(zip, {
        delimiters:{start:'{{', end:'}}'},
        paragraphLoop:true,
        linebreaks:true,
        nullGetter(){
          return '';
        }
      });
      const reportData = getCleanReportData(report);
      documentTemplate.render(reportData);
      downloadBlob(documentTemplate.toBlob(), createDownloadName(report, reportData));
      setStatus(status, 'تم تجهيز التقرير وتنزيله بنجاح.');
    }catch(error){
      const message = error instanceof Error && error.message
        ? error.message
        : 'تعذر إنشاء التقرير. حاول مرة أخرى.';
      setStatus(status, message, true);
    }finally{
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  function createReportCard(report){
    const card = document.createElement('article');
    card.className = 'manager-report-card';
    card.dataset.reportId = report.id;

    const top = document.createElement('div');
    top.className = 'manager-report-card-top';

    const preview = document.createElement('div');
    preview.className = 'manager-report-preview';
    preview.setAttribute('aria-hidden', 'true');
    const previewPage = document.createElement('div');
    previewPage.className = 'manager-report-preview-page';
    const previewHeader = document.createElement('span');
    previewHeader.className = 'manager-report-preview-header';
    const previewTitle = document.createElement('span');
    previewTitle.className = 'manager-report-preview-title';
    const previewLines = document.createElement('span');
    previewLines.className = 'manager-report-preview-lines';
    const previewTable = document.createElement('span');
    previewTable.className = 'manager-report-preview-table';

    const icon = document.createElement('span');
    icon.className = 'manager-report-icon';
    icon.setAttribute('aria-hidden', 'true');
    const iconGlyph = document.createElement('i');
    iconGlyph.className = 'fa-solid fa-file-word';
    icon.appendChild(iconGlyph);
    previewPage.append(previewHeader, previewTitle, previewLines, previewTable);
    preview.append(previewPage, icon);

    const badges = document.createElement('div');
    badges.className = 'manager-report-badges';
    const category = document.createElement('span');
    category.textContent = report.category;
    const statusBadge = document.createElement('span');
    statusBadge.className = 'is-status';
    statusBadge.textContent = report.status;
    const formatBadge = document.createElement('span');
    formatBadge.className = 'is-word';
    formatBadge.textContent = 'Word';
    badges.append(category, statusBadge, formatBadge);
    top.append(badges);

    const title = document.createElement('h3');
    title.textContent = report.title;
    const description = document.createElement('p');
    description.className = 'manager-report-description';
    description.textContent = report.description;

    const fieldsTitle = document.createElement('h4');
    fieldsTitle.textContent = 'البيانات المستخدمة';
    const fields = document.createElement('ul');
    fields.className = 'manager-report-fields';
    report.fields.forEach(field=>{
      const item = document.createElement('li');
      const check = document.createElement('span');
      check.textContent = '✓';
      check.setAttribute('aria-hidden', 'true');
      item.append(check, document.createTextNode(reportFieldLabels[field] || field));
      fields.appendChild(item);
    });

    const actions = document.createElement('div');
    actions.className = 'manager-report-card-actions';
    const actionHint = document.createElement('p');
    actionHint.className = 'manager-report-format-hint';
    actionHint.textContent = 'للحصول على PDF مطابق للتنسيق، افتح ملف Word ثم اختر: ملف ← حفظ باسم ← PDF.';
    const wordDownload = document.createElement('button');
    wordDownload.className = 'manager-report-download';
    wordDownload.type = 'button';
    wordDownload.dataset.reportWord = report.id;
    wordDownload.textContent = 'تنزيل Word معبأ';
    if(Array.isArray(report.customFields) && report.customFields.length){
      const customizeButton = document.createElement('button');
      customizeButton.className = 'manager-report-customize';
      customizeButton.type = 'button';
      customizeButton.dataset.reportCustomize = report.id;
      customizeButton.textContent = 'تخصيص التقرير';
      actions.appendChild(customizeButton);
    }
    const reportStatus = document.createElement('p');
    reportStatus.className = 'manager-report-status';
    reportStatus.dataset.reportStatus = report.id;
    reportStatus.setAttribute('role', 'status');
    reportStatus.setAttribute('aria-live', 'polite');
    actions.append(wordDownload, actionHint, reportStatus);

    card.append(preview, top, title, description, fieldsTitle, fields, actions);
    return card;
  }

  function normalizeSearch(value){
    return String(value || '').trim().toLocaleLowerCase('ar').replace(/\s+/g, ' ');
  }

  function renderManagerReportLibrary(){
    const query = normalizeSearch(search.value);
    const renderKey = `${activeCategory}\u0000${query}`;
    if(renderKey === lastRenderKey) return;

    const reports = managerReportTemplates.filter(report=>{
      const matchesCategory = activeCategory === 'الكل' || report.category === activeCategory;
      const searchable = reportSearchText.get(report.id) || '';
      return matchesCategory && (!query || searchable.includes(query));
    });
    grid.replaceChildren(...reports.map(createReportCard));
    empty.hidden = reports.length > 0;
    lastRenderKey = renderKey;
  }

  function scheduleManagerReportLibraryRender(){
    if(renderFrame) cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(()=>{
      renderFrame = 0;
      renderManagerReportLibrary();
    });
  }

  search.addEventListener('input', scheduleManagerReportLibraryRender);
  categoryButtons.forEach(button=>{
    button.addEventListener('click', ()=>{
      activeCategory = button.dataset.reportCategory || 'الكل';
      categoryButtons.forEach(candidate=>{
        candidate.setAttribute('aria-pressed', String(candidate === button));
      });
      scheduleManagerReportLibraryRender();
    });
  });

  grid.addEventListener('click', event=>{
    const customizeButton = event.target.closest('[data-report-customize]');
    if(customizeButton){
      const report = managerReportTemplates.find(
        item=>item.id === customizeButton.dataset.reportCustomize
      );
      if(report) openCustomizationModal(report, customizeButton);
      return;
    }
    const button = event.target.closest('[data-report-word]');
    if(!button) return;
    const report = managerReportTemplates.find(item=>item.id === button.dataset.reportWord);
    if(!report) return;
    const status = grid.querySelector(`[data-report-status="${report.id}"]`);
    generateManagerReport(report, button, status);
  });

  window.renderManagerReportLibrary = ()=>{
    managerReportsReady.then(loaded=>{
      if(!loaded) return;
      lastRenderKey = '';
      renderManagerReportLibrary();
    });
  };
})();
