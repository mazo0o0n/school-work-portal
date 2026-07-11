const aiAssistant = document.getElementById('aiAssistant');
const aiToggle = document.getElementById('aiToggle');
const aiPanel = document.getElementById('aiPanel');
const aiClose = document.getElementById('aiClose');
const aiForm = document.getElementById('aiForm');
const aiQuestion = document.getElementById('aiQuestion');
const aiMessages = document.getElementById('aiMessages');
const aiSuggestions = document.getElementById('aiSuggestions');
const aiExportQuestions = document.getElementById('aiExportQuestions');
const aiShowQuestions = document.getElementById('aiShowQuestions');
const aiSendQuestions = document.getElementById('aiSendQuestions');
const aiClearQuestions = document.getElementById('aiClearQuestions');
const aiReviewList = document.getElementById('aiReviewList');
const aiPendingCount = document.getElementById('aiPendingCount');
const aiKnowledgeCount = document.getElementById('aiKnowledgeCount');
const unansweredStorageKey = 'platformAiUnansweredQuestions';
const aiReviewWhatsappNumber = '966558834103';
const aiKnowledgeItemsFallback = 118;
let aiKnowledgeItemsCount = aiKnowledgeItemsFallback;
let aiPageScrollY = 0;

function renderAiKnowledgeCount(){
  if(aiKnowledgeCount){
    aiKnowledgeCount.textContent = `${aiKnowledgeItemsCount} سؤال/إجابة متاحة`;
  }
}

async function loadAiKnowledgeCount(){
  try{
    const response = await fetch('assets/data/knowledge-stats.json');
    if(!response.ok) throw new Error('Knowledge stats request failed');

    const stats = await response.json();
    if(!Number.isInteger(stats.qa_count) || stats.qa_count < 0){
      throw new Error('Invalid knowledge stats');
    }
    aiKnowledgeItemsCount = stats.qa_count;
  }catch(_){
    aiKnowledgeItemsCount = aiKnowledgeItemsFallback;
  }
  renderAiKnowledgeCount();
}

loadAiKnowledgeCount();

const apiFallbackAnswer = 'ما عندي معلومة مؤكدة عن هذا السؤال حاليًا، تقدر تعيد صياغته أو تراجع الجهة المختصة.';

function normalizeQuestion(value){
  return String(value || '')
    .toLowerCase()
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/گ/g, 'ك')
    .replace(/چ/g, 'ج')
    .replace(/پ/g, 'ب')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[؟?.,،؛:!()[\]{}"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForMatching(value){
  return normalizeQuestion(value)
    .replace(/\bالدخلي\b/g, 'الداخلي')
    .replace(/\bداخلى\b/g, 'داخلي')
    .replace(/\bداخللى\b/g, 'داخلي')
    .replace(/\bالمعلمات\b/g, 'معلمات')
    .replace(/\bالمعلمين\b/g, 'معلمين')
    .replace(/\bالمعلمون\b/g, 'معلمين')
    .replace(/\bالمعلمه\b/g, 'معلمه')
    .replace(/\bالمعلم\b/g, 'معلم')
    .replace(/\bشنو\b/g, 'ما')
    .replace(/\bوش\b/g, 'ما')
    .replace(/\bايش\b/g, 'ما')
    .replace(/\bوشو\b/g, 'ما هو')
    .replace(/\bماهو\b/g, 'ما هو')
    .replace(/\s+/g, ' ')
    .trim();
}

function getMeaningfulTokens(value){
  const stopWords = new Set([
    'ما', 'هو', 'هي', 'في', 'من', 'عن', 'على', 'الي', 'الى', 'او', 'و',
    'هل', 'كيف', 'متي', 'متى', 'يمكن', 'لمن', 'داخل', 'نفس', 'هذا', 'هذه'
  ]);

  return normalizeForMatching(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function levenshteinDistance(a, b){
  if(a === b) return 0;
  if(!a.length) return b.length;
  if(!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);

  for(let i = 1; i <= a.length; i += 1){
    current[0] = i;
    for(let j = 1; j <= b.length; j += 1){
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

function areTokensClose(a, b){
  if(a === b) return true;
  if(a.length <= 2 || b.length <= 2) return false;
  if(a.includes(b) || b.includes(a)) return true;

  const distance = levenshteinDistance(a, b);
  const limit = Math.max(a.length, b.length) >= 7 ? 2 : 1;
  return distance <= limit;
}

function scoreKeywordMatch(question, keyword){
  const q = normalizeForMatching(question);
  const k = normalizeForMatching(keyword);
  if(!k) return 0;
  if(q.includes(k)) return 100 + Math.min(k.length, 40);

  const questionTokens = getMeaningfulTokens(q);
  const keywordTokens = getMeaningfulTokens(k);
  if(!keywordTokens.length || !questionTokens.length) return 0;

  let matched = 0;
  keywordTokens.forEach((keywordToken) => {
    if(questionTokens.some((questionToken) => areTokensClose(questionToken, keywordToken))){
      matched += 1;
    }
  });

  const coverage = matched / keywordTokens.length;
  const support = matched / Math.max(questionTokens.length, 1);
  if(matched >= 2 && coverage >= 0.6) return Math.round((coverage * 70) + (support * 30));
  if(keywordTokens.length === 1 && matched === 1) return 45;
  return 0;
}

function scoreKnowledgeItem(item, question){
  const normalized = normalizeForMatching(question);
  if(item.match?.(normalized)) return 160;

  const keywordScores = (item.keywords || []).map((keyword) => scoreKeywordMatch(normalized, keyword));
  return keywordScores.length ? Math.max(...keywordScores) : 0;
}

function isInternalTransferDefinitionQuestion(value){
  const q = normalizeForMatching(value)
    .replace(/\bالدخلي\b/g, 'الداخلي')
    .replace(/\bداخلي\b/g, 'الداخلي')
    .replace(/\bداخلى\b/g, 'الداخلي')
    .replace(/\bالمعلمة\b/g, 'المعلمه')
    .replace(/\bالمعلمين\b/g, 'المعلمون');

  const hasInternalTransfer = q.includes('النقل الداخلي') || q.includes('حركه النقل الداخلي');
  if(!hasInternalTransfer) return false;

  const definitionSignals = [
    'ما هو',
    'ماهو',
    'ما المقصود',
    'ماذا يعني',
    'تعريف',
    'مفهوم',
    'معني',
    'توضيح',
    'حركه',
    'الهدف',
    'اهميه',
    'ضوابط',
    'اليه',
    'كيف تتم',
    'الفرق بين',
    'النقل الخارجي',
    'لمن يتاح',
    'الحالات التي يمكن',
    'متي يحق',
    'متي يتاح',
    'كيف يمكن للمعلم',
    'كيف يمكن للمعلمه',
    'بين المدارس داخل نفس الاداره'
  ];

  return definitionSignals.some((signal) => q.includes(signal));
}

function getUnansweredQuestions(){
  try{
    return JSON.parse(localStorage.getItem(unansweredStorageKey) || '[]');
  }catch(_){
    return [];
  }
}

function saveUnansweredQuestion(question){
  const normalized = normalizeQuestion(question);
  const list = getUnansweredQuestions();
  const existing = list.find((item) => item.normalized === normalized);
  if(existing){
    existing.count += 1;
    existing.lastAskedAt = new Date().toISOString();
  }else{
    list.push({
      question,
      normalized,
      count: 1,
      firstAskedAt: new Date().toISOString(),
      lastAskedAt: new Date().toISOString()
    });
  }
  localStorage.setItem(unansweredStorageKey, JSON.stringify(list));
  updatePendingCount();
  if(aiReviewList && !aiReviewList.hidden) renderReviewList();
}

function updatePendingCount(){
  const count = getUnansweredQuestions().length;
  aiPendingCount.textContent = `${count} ${count === 1 ? 'سؤال' : 'أسئلة'} للمراجعة`;
}

function updateKnowledgeCount(){
  if(!aiKnowledgeCount) return;
  aiKnowledgeCount.textContent = 'قاعدة المعرفة متصلة بملفات المنصة';
}

function formatReviewDate(value){
  if(!value) return '';
  return new Date(value).toLocaleString('ar-SA', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
}

function renderReviewList(){
  if(!aiReviewList) return;
  const data = getUnansweredQuestions();
  aiReviewList.innerHTML = '';

  if(!data.length){
    const empty = document.createElement('p');
    empty.className = 'ai-review-empty';
    empty.textContent = 'لا توجد أسئلة غير مجابة حاليًا.';
    aiReviewList.appendChild(empty);
    return;
  }

  data.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'ai-review-item';
    row.textContent = item.question;

    const meta = document.createElement('span');
    meta.className = 'ai-review-meta';
    meta.textContent = `التكرار: ${item.count} - آخر سؤال: ${formatReviewDate(item.lastAskedAt)}`;

    row.appendChild(meta);
    aiReviewList.appendChild(row);
  });
}

function buildReviewMessage(){
  const data = getUnansweredQuestions();
  if(!data.length) return '';
  const lines = [
    '*أسئلة غير مجابة من مساعد منصة التنظيم المدرسي والموارد التعليمية:*',
    ''
  ];

  data.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.question}`);
    lines.push('');
  });

  return lines.join('\n');
}

async function findAnswer(question){
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ question })
  });

  if(!response.ok){
    throw new Error('AI chat request failed');
  }

  const data = await response.json();
  const answer = String(data.answer || '').trim();
  if(!answer) return null;

  return {
    answer,
    source: data.source || 'قاعدة معرفة المنصة',
    missed: Boolean(data.notFound) || answer === apiFallbackAnswer
  };
}

function addAiMessage(text, type = 'bot', source = '', missed = false){
  const message = document.createElement('div');
  message.className = `ai-message ${type}${missed ? ' is-missed' : ''}`;
  message.textContent = text;
  if(source){
    const sourceEl = document.createElement('span');
    sourceEl.className = 'ai-source';
    sourceEl.textContent = `المصدر: ${source}`;
    message.appendChild(sourceEl);
  }
  aiMessages.appendChild(message);
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

function addMissedQuestionMessage(text = apiFallbackAnswer){
  addAiMessage(text, 'bot', 'سجل الأسئلة غير المجابة', true);
}

async function answerQuestion(question){
  addAiMessage(question, 'user');
  try{
    const answer = await findAnswer(question);
    if(answer && !answer.missed){
      addAiMessage(answer.answer, 'bot', answer.source);
      return;
    }
    saveUnansweredQuestion(question);
    addMissedQuestionMessage(answer?.answer || apiFallbackAnswer);
  }catch(_){
    saveUnansweredQuestion(question);
    addMissedQuestionMessage();
  }
}

async function submitAiQuestion(question){
  const normalizedQuestion = String(question || '').trim();
  if(!normalizedQuestion) return;

  aiQuestion.value = '';
  if(aiSuggestions) aiSuggestions.hidden = true;
  await answerQuestion(normalizedQuestion);
  aiQuestion.focus();
}

function openAiPanel(){
  aiPanel.hidden = false;
  aiToggle.setAttribute('aria-expanded', 'true');
  aiPageScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.style.top = `-${aiPageScrollY}px`;
  document.body.classList.add('ai-panel-open');
  renderAiKnowledgeCount();
  if(!aiMessages.querySelector('.ai-message')){
    addAiMessage('مرحبًا، اسألني عن خدمات المنصة، الأدلة، الأنظمة، أدوات الدعم، أو الأسئلة الشائعة.', 'bot', 'قاعدة معرفة المنصة');
  }
  if(aiSuggestions && !aiSuggestions.hidden){
    aiMessages.appendChild(aiSuggestions);
  }
  aiQuestion.focus();
}

function closeAiPanel(){
  aiPanel.hidden = true;
  aiToggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('ai-panel-open');
  document.body.style.top = '';
  window.scrollTo(0, aiPageScrollY);
}

aiToggle?.addEventListener('click', () => {
  aiPanel.hidden ? openAiPanel() : closeAiPanel();
});

aiClose?.addEventListener('click', closeAiPanel);

aiForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  await submitAiQuestion(aiQuestion.value);
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('#aiSuggestions [data-question]');
  if(!button) return;
  await submitAiQuestion(button.textContent);
});

aiExportQuestions?.addEventListener('click', () => {
  const data = getUnansweredQuestions();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ai-unanswered-questions.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

aiShowQuestions?.addEventListener('click', () => {
  if(!aiReviewList) return;
  aiReviewList.hidden = !aiReviewList.hidden;
  aiShowQuestions.textContent = aiReviewList.hidden ? 'عرض الأسئلة' : 'إخفاء الأسئلة';
  if(!aiReviewList.hidden) renderReviewList();
});

aiSendQuestions?.addEventListener('click', () => {
  const message = buildReviewMessage();
  if(!message){
    addAiMessage('لا توجد أسئلة غير مجابة لإرسالها حاليًا.', 'bot', 'سجل الأسئلة غير المجابة');
    return;
  }
  const url = `https://wa.me/${aiReviewWhatsappNumber}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank', 'noopener');
});

aiClearQuestions?.addEventListener('click', () => {
  localStorage.removeItem(unansweredStorageKey);
  updatePendingCount();
  renderReviewList();
});

document.addEventListener('keydown', (event) => {
  if(event.key === 'Escape' && !aiPanel.hidden) closeAiPanel();
});

updatePendingCount();
updateKnowledgeCount();
