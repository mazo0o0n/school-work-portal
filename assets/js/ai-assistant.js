const aiAssistant = document.getElementById('aiAssistant');
const aiToggle = document.getElementById('aiToggle');
const aiPanel = document.getElementById('aiPanel');
const aiClose = document.getElementById('aiClose');
const aiClearConversation = document.getElementById('aiClearConversation');
const aiForm = document.getElementById('aiForm');
const aiSubmit = document.getElementById('aiSubmit');
const aiQuestion = document.getElementById('aiQuestion');
const aiMessages = document.getElementById('aiMessages');
const aiSuggestions = document.getElementById('aiSuggestions');
const aiExportQuestions = document.getElementById('aiExportQuestions');
const aiShowQuestions = document.getElementById('aiShowQuestions');
const aiSendQuestions = document.getElementById('aiSendQuestions');
const aiReviewHint = document.getElementById('aiReviewHint');
const aiClearQuestions = document.getElementById('aiClearQuestions');
const aiReviewList = document.getElementById('aiReviewList');
const aiPendingCount = document.getElementById('aiPendingCount');
const aiKnowledgeCount = document.getElementById('aiKnowledgeCount');
const unansweredStorageKey = 'platformAiUnansweredQuestions';
const aiConversationSessionKey = 'platformAiConversationSession';
const aiPanelOpenSessionKey = 'platformAiPanelOpenSession';
const aiReviewWhatsappNumber = '966558834103';
const aiKnowledgeItemsFallback = 118;
const aiMaxStoredMessages = 50;
const maxLocalReviewQuestionLength = 500;
const aiGreetingText = 'مرحبًا، اسألني عن خدمات المنصة، الأدلة، الأنظمة، أدوات الدعم، أو الأسئلة الشائعة.';
const aiGreetingSource = 'قاعدة معرفة المنصة';
let aiKnowledgeItemsCount = aiKnowledgeItemsFallback;
let aiPageScrollY = 0;
let aiReviewHintTimeout = 0;
let aiRequestPending = false;
let aiHistoryEntryActive = false;

function setAiConversationStarted(started){
  aiPanel.classList.toggle('ai-conversation-started', Boolean(started));
}

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

function persistAiConversation(){
  try{
    const messages = [...aiMessages.querySelectorAll('.ai-message')].map((message) => ({
      role: message.classList.contains('user') ? 'user' : 'assistant',
      text: message.dataset.messageText || '',
      source: message.dataset.messageSource || '',
      customType: normalizeAiCustomType(message.dataset.messageCustomType),
      images: getAiMessageImages(message)
    })).filter((message) => message.text).slice(-aiMaxStoredMessages);

    if(messages.length){
      sessionStorage.setItem(aiConversationSessionKey, JSON.stringify(messages));
    }else{
      sessionStorage.removeItem(aiConversationSessionKey);
    }
  }catch(_){
    try{
      sessionStorage.removeItem(aiConversationSessionKey);
    }catch(_storageError){
      // لا يوجد إجراء إضافي إذا كان sessionStorage محظورًا بالكامل.
    }
    // تظل المحادثة تعمل حتى إذا كان sessionStorage غير متاح.
  }
}

function restoreAiConversation(){
  try{
    const messages = JSON.parse(sessionStorage.getItem(aiConversationSessionKey) || '[]');
    if(!Array.isArray(messages)){
      sessionStorage.removeItem(aiConversationSessionKey);
      return false;
    }
    if(!messages.length) return false;

    messages.slice(-aiMaxStoredMessages).forEach((message) => {
      if(message?.role !== 'user' && message?.role !== 'assistant') return;
      const text = String(message.text || '').trim();
      if(!text) return;
      const source = typeof message.source === 'string' ? message.source : '';
      const customType = normalizeAiCustomType(message.customType);
      const images = normalizeAiImages(message.images);
      addAiMessage(text, message.role === 'user' ? 'user' : 'bot', source, false, false, images, customType);
    });
    return Boolean(aiMessages.querySelector('.ai-message'));
  }catch(_){
    try{
      sessionStorage.removeItem(aiConversationSessionKey);
    }catch(_storageError){
      // لا يوجد إجراء إضافي إذا كان sessionStorage محظورًا بالكامل.
    }
    return false;
  }
}

function setAiPanelSessionState(isOpen){
  try{
    sessionStorage.setItem(aiPanelOpenSessionKey, isOpen ? '1' : '0');
  }catch(_){
    // لا يؤثر تعذر التخزين في فتح المساعد أو إغلاقه.
  }
}

function wasAiPanelOpen(){
  try{
    const value = sessionStorage.getItem(aiPanelOpenSessionKey);
    if(value === '1') return true;
    if(value === null || value === '0') return false;
    sessionStorage.removeItem(aiPanelOpenSessionKey);
    return false;
  }catch(_){
    return false;
  }
}

function isMobileAssistantView(){
  return window.matchMedia('(max-width: 900px)').matches;
}

const legacyApiFallbackAnswer = 'ما عندي معلومة مؤكدة عن هذا السؤال حاليًا، تقدر تعيد صياغته أو تراجع الجهة المختصة.';
const apiFallbackAnswer = 'لم أجد إجابة موثقة لهذا السؤال داخل ملفات المنصة حاليًا.\nجرّب صياغة أبسط، أو اضغط "طلب إضافة السؤال" ليتم مراجعته وإضافته لاحقًا.';

function hideAiReviewHint(){
  window.clearTimeout(aiReviewHintTimeout);
  aiReviewHintTimeout = 0;
  if(aiReviewHint) aiReviewHint.hidden = true;
  aiSendQuestions?.classList.remove('is-recommended');
}

function showAiReviewHint(){
  hideAiReviewHint();
  if(aiReviewHint) aiReviewHint.hidden = false;
  aiSendQuestions?.classList.add('is-recommended');
  aiReviewHintTimeout = window.setTimeout(hideAiReviewHint, 7000);
}

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

function isSafeLocalReviewQuestion(value){
  const question = String(value || '').trim();
  if(!question || question.length > maxLocalReviewQuestionLength) return false;

  const sensitivePatterns = [
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i,
    /(?:\+?[0-9٠-٩][\s-]?){8,}/,
    /\b(?:bearer|authorization|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|token)\b/i,
    /(?:كلمة المرور|رمز التحقق|رمز الدخول|مفتاح api|توكن)/i,
    /\b(?:sk|pk|rk|cf)[-_][a-z0-9_-]{12,}\b/i
  ];

  return !sensitivePatterns.some((pattern) => pattern.test(question));
}

function getUnansweredQuestions(){
  try{
    const stored = JSON.parse(localStorage.getItem(unansweredStorageKey) || '[]');
    if(!Array.isArray(stored)){
      localStorage.removeItem(unansweredStorageKey);
      return [];
    }

    const safeItems = stored.filter((item) => isSafeLocalReviewQuestion(item?.question));
    if(safeItems.length !== stored.length){
      localStorage.setItem(unansweredStorageKey, JSON.stringify(safeItems));
    }
    return safeItems;
  }catch(_){
    try{
      localStorage.removeItem(unansweredStorageKey);
    }catch(_storageError){
      // لا يوجد إجراء إضافي إذا كان localStorage محظورًا بالكامل.
    }
    return [];
  }
}

function saveUnansweredQuestion(question){
  if(!isSafeLocalReviewQuestion(question)) return;
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
  aiReviewList.replaceChildren();

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
    missed: Boolean(data.notFound) || answer === apiFallbackAnswer || answer === legacyApiFallbackAnswer,
    images: normalizeAiImages(data.images),
    customType: normalizeAiCustomType(data.customType)
  };
}

function normalizeAiCustomType(value){
  return value === 'nora-secret' ? 'nora-secret' : '';
}

function normalizeAiImages(value){
  if(!Array.isArray(value)) return [];

  return value.slice(0, 4).map((image) => {
    const src = typeof image?.src === 'string' ? image.src.trim() : '';
    if(!/^\/assets\/knowledge-images\/[A-Za-z0-9._/-]+\.(?:jpg|jpeg|png|webp)$/i.test(src) || src.includes('..')){
      return null;
    }
    return {
      src,
      alt: String(image.alt || 'صورة من معرفة المنصة').trim().slice(0, 200),
      caption: String(image.caption || '').trim().slice(0, 200)
    };
  }).filter(Boolean);
}

function getAiMessageImages(message){
  try{
    return normalizeAiImages(JSON.parse(message.dataset.messageImages || '[]'));
  }catch(_){
    return [];
  }
}

function appendAiImages(message, images){
  images.forEach((image) => {
    const card = document.createElement('figure');
    card.className = 'ai-image-card';

    const link = document.createElement('a');
    link.className = 'ai-image-link';
    link.setAttribute('href', image.src);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener');

    const imageEl = document.createElement('img');
    imageEl.setAttribute('src', image.src);
    imageEl.setAttribute('alt', image.alt);
    imageEl.setAttribute('loading', 'lazy');
    link.appendChild(imageEl);
    card.appendChild(link);

    if(image.caption){
      const caption = document.createElement('figcaption');
      caption.textContent = image.caption;
      card.appendChild(caption);
    }

    const openLink = document.createElement('a');
    openLink.className = 'ai-image-open';
    openLink.textContent = 'فتح الصورة';
    openLink.setAttribute('href', image.src);
    openLink.setAttribute('target', '_blank');
    openLink.setAttribute('rel', 'noopener');
    card.appendChild(openLink);
    message.appendChild(card);
  });
}

function addAiMessage(text, type = 'bot', source = '', missed = false, persist = true, images = [], customType = ''){
  const message = document.createElement('div');
  const safeImages = normalizeAiImages(images);
  const safeCustomType = type === 'bot' ? normalizeAiCustomType(customType) : '';
  message.className = `ai-message ${type}${missed ? ' is-missed' : ''}`;
  if(safeCustomType === 'nora-secret') message.classList.add('ai-message-nora-secret');
  message.dataset.messageText = text;
  message.dataset.messageSource = source;
  if(safeCustomType) message.dataset.messageCustomType = safeCustomType;
  if(safeImages.length) message.dataset.messageImages = JSON.stringify(safeImages);
  message.textContent = text;
  appendAiImages(message, safeImages);
  if(source){
    const sourceEl = document.createElement('span');
    sourceEl.className = 'ai-source';
    sourceEl.textContent = `المصدر: ${source}`;
    message.appendChild(sourceEl);
  }
  aiMessages.appendChild(message);
  aiMessages.scrollTop = aiMessages.scrollHeight;
  if(persist) persistAiConversation();
  return message;
}

function addMissedQuestionMessage(text = apiFallbackAnswer){
  addAiMessage(text, 'bot', 'سجل الأسئلة غير المجابة', true);
}

async function answerQuestion(question){
  hideAiReviewHint();
  addAiMessage(question, 'user');
  const loadingMessage = addAiMessage('جاري البحث في معرفة المنصة...', 'bot', '', false, false);
  loadingMessage.classList.add('ai-loading');
  aiMessages.setAttribute('aria-busy', 'true');
  try{
    const answer = await findAnswer(question);
    loadingMessage.remove();
    if(answer && !answer.missed){
      addAiMessage(answer.answer, 'bot', answer.source, false, true, answer.images, answer.customType);
      return;
    }
    saveUnansweredQuestion(question);
    addMissedQuestionMessage();
    showAiReviewHint();
  }catch(_){
    loadingMessage.remove();
    saveUnansweredQuestion(question);
    addMissedQuestionMessage();
    showAiReviewHint();
  }finally{
    loadingMessage.remove();
    aiMessages.removeAttribute('aria-busy');
  }
}

async function submitAiQuestion(question){
  const normalizedQuestion = String(question || '').trim();
  if(!normalizedQuestion || aiRequestPending) return;

  aiRequestPending = true;
  aiSubmit.disabled = true;
  aiQuestion.value = '';
  if(aiSuggestions) aiSuggestions.hidden = true;
  setAiConversationStarted(true);
  if(isMobileAssistantView()) aiQuestion.blur();
  try{
    await answerQuestion(normalizedQuestion);
    window.requestAnimationFrame(() => {
      aiMessages.scrollTop = aiMessages.scrollHeight;
    });
  }finally{
    aiRequestPending = false;
    aiSubmit.disabled = false;
    if(!isMobileAssistantView()) aiQuestion.focus();
  }
}

function addAiMobileHistoryEntry(){
  if(!isMobileAssistantView() || aiHistoryEntryActive) return;
  try{
    history.pushState({ ...history.state, aiAssistantOpen: true }, '');
    aiHistoryEntryActive = true;
  }catch(_){
    aiHistoryEntryActive = false;
  }
}

function openAiPanel(){
  aiPanel.hidden = false;
  aiToggle.setAttribute('aria-expanded', 'true');
  aiPageScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.style.top = `-${aiPageScrollY}px`;
  document.body.classList.add('ai-panel-open');
  setAiPanelSessionState(true);
  addAiMobileHistoryEntry();
  renderAiKnowledgeCount();
  if(!aiMessages.querySelector('.ai-message')){
    addAiMessage(aiGreetingText, 'bot', aiGreetingSource);
  }
  if(aiSuggestions && !aiSuggestions.hidden){
    aiMessages.appendChild(aiSuggestions);
  }
  if(!isMobileAssistantView()) aiQuestion.focus();
}

function closeAiPanel(options = {}){
  const shouldRemoveHistoryEntry = aiHistoryEntryActive && !options.fromHistory;
  aiPanel.hidden = true;
  aiToggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('ai-panel-open');
  setAiPanelSessionState(false);
  document.body.style.top = '';
  window.scrollTo(0, aiPageScrollY);
  if(shouldRemoveHistoryEntry){
    aiHistoryEntryActive = false;
    history.back();
  }
}

aiToggle?.addEventListener('click', () => {
  aiPanel.hidden ? openAiPanel() : closeAiPanel();
});

aiClose?.addEventListener('click', closeAiPanel);

aiClearConversation?.addEventListener('click', () => {
  hideAiReviewHint();
  try{
    sessionStorage.removeItem(aiConversationSessionKey);
  }catch(_){
    // يكفي مسح الرسائل الظاهرة إذا كان sessionStorage غير متاح.
  }
  aiMessages.querySelectorAll('.ai-message').forEach((message) => message.remove());
  aiQuestion.value = '';
  aiQuestion.blur();
  setAiConversationStarted(false);
  if(aiSuggestions){
    aiSuggestions.hidden = false;
  }
  addAiMessage(aiGreetingText, 'bot', aiGreetingSource, false, false);
  if(aiSuggestions) aiMessages.appendChild(aiSuggestions);
  aiMessages.scrollTop = 0;
  if(!isMobileAssistantView()) aiQuestion.focus();
});

aiForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  await submitAiQuestion(aiQuestion.value);
});

aiQuestion?.addEventListener('keydown', (event) => {
  if(event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  aiForm.requestSubmit();
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
  hideAiReviewHint();
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

window.addEventListener('popstate', () => {
  if(!aiHistoryEntryActive || aiPanel.hidden) return;
  aiHistoryEntryActive = false;
  closeAiPanel({ fromHistory: true });
});

updatePendingCount();
updateKnowledgeCount();
restoreAiConversation();
const restoredAiConversationStarted = Boolean(aiMessages.querySelector('.ai-message.user'));
setAiConversationStarted(restoredAiConversationStarted);
if(aiSuggestions) aiSuggestions.hidden = restoredAiConversationStarted;
if(wasAiPanelOpen()) openAiPanel();
