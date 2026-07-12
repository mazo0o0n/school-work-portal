(() => {
  'use strict';

  const questions = [
    ['وش منصة التنظيم المدرسي؟', 'يجب أن يجيب', 'knowledge.md'],
    ['ما هي منصة التنظيم المدرسي؟', 'يجب أن يجيب', 'knowledge.md'],
    ['ما الخدمات المتاحة في المنصة؟', 'يجب أن يجيب', 'knowledge.md'],
    ['أين أجد روابط المنصات التعليمية؟', 'يجب أن يجيب', 'knowledge.md'],
    ['أين أجد الأدلة والأنظمة؟', 'يجب أن يجيب', 'knowledge.md'],
    ['كيف أسجل مدرسة؟', 'يجب أن يجيب', 'knowledge.md'],
    ['ما هي خدمات بوابة التعليم؟', 'يجب أن يجيب', 'ministry-education-portal-services-faq.md'],
    ['وش شروط ترقية المعلمين؟', 'يجب أن يجيب', 'teacher-promotions-2026-faq.md'],
    ['ما هو برنامج فرص؟', 'يجب أن يجيب', 'furas-program-faq.md'],
    ['ما هو التطوير المهني التعليمي؟', 'يجب أن يجيب', 'professional-development-faq.md'],
    ['ما هو برنامج الدبلوم التأهيلي للتربية البدنية؟', 'يجب أن يجيب', 'physical-education-qualifying-diploma-faq.md'],
    ['كم سعر الدولار؟', 'يجب أن يرفض / fallback', 'لا يوجد مصدر داخل معرفة المنصة']
  ];

  const tableBody = document.getElementById('questionsTableBody');
  const copyAllButton = document.getElementById('copyAllQuestions');
  const copyStatus = document.getElementById('copyStatus');

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

  questions.forEach(([question, expected, source]) => {
    const row = document.createElement('tr');

    const questionCell = document.createElement('td');
    const questionText = document.createElement('span');
    questionText.textContent = question;
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'copy-question';
    copyButton.textContent = 'نسخ';
    copyButton.setAttribute('aria-label', `نسخ السؤال: ${question}`);
    copyButton.addEventListener('click', async () => {
      showStatus(await copyText(question) ? 'تم نسخ السؤال.' : 'تعذر النسخ. انسخ السؤال يدويًا.');
    });
    questionCell.append(questionText, copyButton);

    const expectedCell = document.createElement('td');
    expectedCell.textContent = expected;
    const sourceCell = document.createElement('td');
    sourceCell.textContent = source;
    const statusCell = document.createElement('td');
    statusCell.textContent = '⚠️ يحتاج اختبار';
    const notesCell = document.createElement('td');
    notesCell.textContent = '';

    row.append(questionCell, expectedCell, sourceCell, statusCell, notesCell);
    tableBody.append(row);
  });

  copyAllButton.addEventListener('click', async () => {
    const text = questions.map(([question]) => question).join('\n');
    showStatus(await copyText(text) ? 'تم نسخ كل الأسئلة.' : 'تعذر النسخ. انسخ الأسئلة يدويًا.');
  });
})();
