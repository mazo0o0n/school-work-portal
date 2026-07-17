(function(){
  'use strict';

  const managerReportTemplates = [
    {
      id:'meeting-template-test',
      title:'سجل اجتماعات الأقسام',
      description:'نموذج لاجتماعات الأقسام واللجان والمجتمعات المهنية.',
      category:'الاجتماعات',
      sectionId:'managerReports',
      templatePath:'assets/report-templates/manager-reports/meeting-template-test.docx',
      outputFileName:'سجل اجتماعات الأقسام - {{schoolDisplayName}}.docx',
      fields:[
        'educationDepartment',
        'schoolDisplayName',
        'principalName',
        'educationalAffairsAgent'
      ],
      status:'تجريبي'
    },
    {
      id:'academic-achievement-committee',
      title:'تشكيل لجنة التحصيل الدراسي',
      description:'نموذج خاص بلجنة التحصيل الدراسي ومتابعة أعمالها.',
      category:'اللجان',
      sectionId:'managerReports',
      templatePath:'assets/report-templates/manager-reports/academic-achievement-committee.docx',
      outputFileName:'تشكيل لجنة التحصيل الدراسي - {{schoolDisplayName}}.docx',
      fields:[
        'educationDepartment',
        'schoolDisplayName',
        'principalName'
      ],
      status:'معتمد'
    },
    {
      id:'health-guide-assignment',
      title:'تكليف الموجه الصحي',
      description:'نموذج تكليف الموجه الصحي بمهامه ومسؤولياته داخل المدرسة.',
      category:'النماذج',
      sectionId:'managerReports',
      templatePath:'assets/report-templates/manager-reports/health-guide-assignment.docx',
      outputFileName:'تكليف الموجه الصحي - {{schoolDisplayName}}.docx',
      fields:[
        'educationDepartment',
        'schoolDisplayName',
        'principalName'
      ],
      status:'معتمد'
    },
    {
      id:'school-guard-assignment',
      title:'تكليف حارس المدرسة',
      description:'نموذج تكليف حارس المدرسة بمهام محددة.',
      category:'النماذج',
      sectionId:'managerReports',
      templatePath:'assets/report-templates/manager-reports/school-guard-assignment.docx',
      outputFileName:'تكليف حارس المدرسة - {{schoolDisplayName}}.docx',
      fields:[
        'educationDepartment',
        'schoolDisplayName',
        'principalName'
      ],
      status:'معتمد'
    },
    {
      id:'activity-leader-assignment-1448',
      title:'تكليف رائد النشاط للعام 1448 هـ',
      description:'نموذج تكليف رائد النشاط بمهام ومسؤوليات النشاط الطلابي.',
      category:'النماذج',
      sectionId:'managerReports',
      templatePath:'assets/report-templates/manager-reports/activity-leader-assignment-1448.docx',
      outputFileName:'تكليف رائد النشاط للعام 1448 هـ - {{schoolDisplayName}}.docx',
      fields:[
        'educationDepartment',
        'schoolDisplayName',
        'principalName'
      ],
      status:'معتمد'
    }
  ];

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

  let activeCategory = 'الكل';
  let lastRenderKey = '';
  let renderFrame = 0;
  const reportSearchText = new Map(
    managerReportTemplates.map(report=>[
      report.id,
      normalizeSearch(`${report.title} ${report.description} ${report.category}`)
    ])
  );

  function createSchoolDisplayName(stage, schoolName){
    return [stage, schoolName]
      .map(value=>String(value || '').trim())
      .filter(Boolean)
      .join(' ');
  }

  function getCleanReportData(sectionId){
    const source = typeof window.getReportMergeData === 'function'
      ? window.getReportMergeData(sectionId)
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
    return data;
  }

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
      const reportData = getCleanReportData(report.sectionId);
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

    const icon = document.createElement('span');
    icon.className = 'manager-report-icon';
    icon.setAttribute('aria-hidden', 'true');
    const iconGlyph = document.createElement('i');
    iconGlyph.className = 'fa-solid fa-file-word';
    icon.appendChild(iconGlyph);

    const badges = document.createElement('div');
    badges.className = 'manager-report-badges';
    const category = document.createElement('span');
    category.textContent = report.category;
    const statusBadge = document.createElement('span');
    statusBadge.className = 'is-status';
    statusBadge.textContent = report.status;
    badges.append(category, statusBadge);
    top.append(icon, badges);

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
    const reportStatus = document.createElement('p');
    reportStatus.className = 'manager-report-status';
    reportStatus.dataset.reportStatus = report.id;
    reportStatus.setAttribute('role', 'status');
    reportStatus.setAttribute('aria-live', 'polite');
    actions.append(wordDownload, actionHint, reportStatus);

    card.append(top, title, description, fieldsTitle, fields, actions);
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
    const button = event.target.closest('[data-report-word]');
    if(!button) return;
    const report = managerReportTemplates.find(item=>item.id === button.dataset.reportWord);
    if(!report) return;
    const status = grid.querySelector(`[data-report-status="${report.id}"]`);
    generateManagerReport(report, button, status);
  });

  window.renderManagerReportLibrary = renderManagerReportLibrary;
})();
