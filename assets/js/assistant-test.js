(() => {
  'use strict';

  const storageKey = 'assistantTestChecklist';
  const statuses = ['لم يختبر', 'نجح', 'فشل', 'يحتاج مراجعة'];
  const questions = [
    { category: 'تعريف المنصة', question: 'وش منصة التنظيم المدرسي؟', expected: 'يجب أن يجيب', source: 'knowledge.md' },
    { category: 'تعريف المنصة', question: 'ما هي منصة التنظيم المدرسي؟', expected: 'يجب أن يجيب', source: 'knowledge.md' },
    { category: 'خدمات المنصة', question: 'ما الخدمات المتاحة في المنصة؟', expected: 'يجب أن يجيب', source: 'knowledge.md' },
    { category: 'روابط وأدلة', question: 'أين أجد روابط المنصات التعليمية؟', expected: 'يجب أن يجيب', source: 'knowledge.md' },
    { category: 'روابط وأدلة', question: 'أين أجد الأدلة والأنظمة؟', expected: 'يجب أن يجيب', source: 'knowledge.md' },
    { category: 'خدمات المنصة', question: 'كيف أسجل مدرسة؟', expected: 'يجب أن يجيب', source: 'knowledge.md' },
    { category: 'بوابة التعليم', question: 'ما هي خدمات بوابة التعليم؟', expected: 'يجب أن يجيب', source: 'ministry-education-portal-services-faq.md' },
    { category: 'الترقيات', question: 'وش شروط ترقية المعلمين؟', expected: 'يجب أن يجيب', source: 'teacher-promotions-2026-faq.md' },
    { category: 'فرص', question: 'ما هو برنامج فرص؟', expected: 'يجب أن يجيب', source: 'furas-program-faq.md' },
    { category: 'التطوير المهني', question: 'ما هو التطوير المهني التعليمي؟', expected: 'يجب أن يجيب', source: 'professional-development-faq.md' },
    { category: 'التطوير المهني', question: 'ما هو برنامج الدبلوم التأهيلي للتربية البدنية؟', expected: 'يجب أن يجيب', source: 'physical-education-qualifying-diploma-faq.md' },
    { category: 'سؤال خارج النطاق', question: 'كم سعر الدولار؟', expected: 'يجب أن يرفض / fallback', source: 'لا يوجد مصدر داخل معرفة المنصة' }
  ];

  const tableBody = document.getElementById('questionsTableBody');
  const copyStatus = document.getElementById('copyStatus');
  const summary = {
    total: document.getElementById('totalCount'),
    passed: document.getElementById('passedCount'),
    failed: document.getElementById('failedCount'),
    review: document.getElementById('reviewCount')
  };
  let results = loadResults();

  function loadResults() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      localStorage.removeItem(storageKey);
      return {};
    }
  }

  function saveResults() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(results));
    } catch {
      showStatus('تعذر حفظ النتائج محليًا.');
    }
  }

  function showStatus(message) {
    copyStatus.textContent = message;
    window.setTimeout(() => {
      if (copyStatus.textContent === message) copyStatus.textContent = '';
    }, 2500);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function updateSummary() {
    const values = questions.map((_, index) => results[index]?.status || statuses[0]);
    summary.total.textContent = String(questions.length);
    summary.passed.textContent = String(values.filter(value => value === 'نجح').length);
    summary.failed.textContent = String(values.filter(value => value === 'فشل').length);
    summary.review.textContent = String(values.filter(value => value === 'يحتاج مراجعة').length);
  }

  function buildReport() {
    const lines = ['تقرير اختبار مساعد المنصة', `عدد الأسئلة: ${questions.length}`];
    statuses.forEach(status => {
      const count = questions.filter((_, index) => (results[index]?.status || statuses[0]) === status).length;
      lines.push(`${status}: ${count}`);
    });
    return lines.join('\n');
  }

  questions.forEach((item, index) => {
    const row = document.createElement('tr');
    const categoryCell = document.createElement('td');
    categoryCell.textContent = item.category;

    const questionCell = document.createElement('td');
    const questionText = document.createElement('span');
    questionText.textContent = item.question;
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'copy-question';
    copyButton.textContent = 'نسخ';
    copyButton.setAttribute('aria-label', `نسخ السؤال: ${item.question}`);
    copyButton.addEventListener('click', async () => {
      showStatus(await copyText(item.question) ? 'تم نسخ السؤال.' : 'تعذر النسخ؛ انسخه يدويًا.');
    });
    questionCell.append(questionText, copyButton);

    const expectedCell = document.createElement('td');
    expectedCell.textContent = item.expected;
    const sourceCell = document.createElement('td');
    sourceCell.textContent = item.source;

    const statusCell = document.createElement('td');
    const statusSelect = document.createElement('select');
    statusSelect.setAttribute('aria-label', `حالة اختبار: ${item.question}`);
    statuses.forEach(status => {
      const option = document.createElement('option');
      option.value = status;
      option.textContent = status;
      statusSelect.append(option);
    });
    statusSelect.value = results[index]?.status || statuses[0];
    statusSelect.addEventListener('change', () => {
      results[index] = { ...results[index], status: statusSelect.value };
      saveResults();
      updateSummary();
    });
    statusCell.append(statusSelect);

    const notesCell = document.createElement('td');
    const notesInput = document.createElement('textarea');
    notesInput.rows = 2;
    notesInput.maxLength = 300;
    notesInput.placeholder = 'ملاحظة اختبار اختيارية';
    notesInput.setAttribute('aria-label', `ملاحظات اختبار: ${item.question}`);
    notesInput.value = typeof results[index]?.note === 'string' ? results[index].note : '';
    notesInput.addEventListener('change', () => {
      results[index] = { ...results[index], note: notesInput.value.trim() };
      saveResults();
    });
    notesCell.append(notesInput);

    row.append(categoryCell, questionCell, expectedCell, sourceCell, statusCell, notesCell);
    tableBody.append(row);
  });

  document.getElementById('copyAllQuestions').addEventListener('click', async () => {
    const text = questions.map(item => item.question).join('\n');
    showStatus(await copyText(text) ? 'تم نسخ كل الأسئلة.' : 'تعذر النسخ؛ انسخ الأسئلة يدويًا.');
  });

  document.getElementById('copyReport').addEventListener('click', async () => {
    showStatus(await copyText(buildReport()) ? 'تم نسخ التقرير.' : 'تعذر نسخ التقرير.');
  });

  document.getElementById('clearResults').addEventListener('click', () => {
    results = {};
    localStorage.removeItem(storageKey);
    document.querySelectorAll('select').forEach(select => { select.value = statuses[0]; });
    document.querySelectorAll('textarea').forEach(textarea => { textarea.value = ''; });
    updateSummary();
    showStatus('تم مسح نتائج الاختبار.');
  });

  updateSummary();
})();
