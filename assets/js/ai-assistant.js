const aiToggle = document.getElementById('aiToggle');
const aiPanel = document.getElementById('aiPanel');
const aiClose = document.getElementById('aiClose');
const aiForm = document.getElementById('aiForm');
const aiSubmit = document.getElementById('aiSubmit');
const aiQuestion = document.getElementById('aiQuestion');
const aiFormStatus = document.getElementById('aiFormStatus');
const aiMessages = document.getElementById('aiMessages');
const aiSuggestions = document.getElementById('aiSuggestions');
const aiKnowledgeCount = document.getElementById('aiKnowledgeCount');
const aiConversationSessionKey = 'platformAiConversationSession';
const aiPanelOpenSessionKey = 'platformAiPanelOpenSession';
const aiKnowledgeItemsFallback = 118;
const aiMaxStoredMessages = 50;
const aiMaxQuestionLength = 1000;
const aiRequestTimeoutMs = 30000;
const aiGreetingText = 'مرحبًا، اسألني عن خدمات المنصة، الأدلة، الأنظمة، أدوات الدعم، أو الأسئلة الشائعة.';
const aiGreetingSource = 'قاعدة معرفة المنصة';
let aiKnowledgeItemsCount = aiKnowledgeItemsFallback;
let aiPageScrollY = 0;
let aiPageScrollLocked = false;
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
  }catch{
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
  }catch{
    try{
      sessionStorage.removeItem(aiConversationSessionKey);
    }catch{
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
  }catch{
    try{
      sessionStorage.removeItem(aiConversationSessionKey);
    }catch{
      // لا يوجد إجراء إضافي إذا كان sessionStorage محظورًا بالكامل.
    }
    return false;
  }
}

function setAiPanelSessionState(isOpen){
  try{
    sessionStorage.setItem(aiPanelOpenSessionKey, isOpen ? '1' : '0');
  }catch{
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
  }catch{
    return false;
  }
}

function isMobileAssistantView(){
  return window.matchMedia('(max-width: 900px)').matches;
}

function setAiFormStatus(message = '', isError = false){
  if(!aiFormStatus) return;
  aiFormStatus.textContent = message;
  aiFormStatus.hidden = !message;
  aiFormStatus.classList.toggle('is-error', Boolean(message && isError));
  aiQuestion?.toggleAttribute('aria-invalid', Boolean(message && isError));
}

function setAiRequestPending(pending){
  aiRequestPending = Boolean(pending);
  aiSubmit.disabled = aiRequestPending;
  aiSubmit.setAttribute('aria-label', aiRequestPending ? 'جاري إرسال السؤال' : 'إرسال السؤال');
  aiForm?.setAttribute('aria-busy', String(aiRequestPending));
  if(aiQuestion){
    aiQuestion.readOnly = aiRequestPending;
    aiQuestion.toggleAttribute('aria-disabled', aiRequestPending);
  }
  aiSuggestions?.querySelectorAll('button').forEach((button) => {
    button.disabled = aiRequestPending;
  });
}

const apiFallbackAnswer = 'ما عندي معلومة مؤكدة عن هذا السؤال حاليًا، تقدر تعيد صياغته أو تراجع الجهة المختصة.';
const missedQuestionDisplayAnswer = apiFallbackAnswer;
const invalidRequestDisplayAnswer = 'تعذر معالجة الطلب. تأكد من إرسال سؤال نصي صالح.';
const temporaryErrorDisplayAnswer = 'تعذر الوصول إلى مساعد المنصة مؤقتًا. حاول مرة أخرى لاحقًا.';
const timeoutErrorDisplayAnswer = 'انتهت مهلة طلب المساعد بعد 30 ثانية. حاول مرة أخرى.';

async function findAnswer(question){
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), aiRequestTimeoutMs);
  try{
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ question }),
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));
    if(!response.ok){
      const requestError = new Error('AI chat request failed');
      requestError.userMessage = response.status >= 400 && response.status < 500
        ? String(data.answer || invalidRequestDisplayAnswer).trim().slice(0, 300)
        : temporaryErrorDisplayAnswer;
      throw requestError;
    }

    const answer = String(data.answer || '').trim();
    if(!answer) return null;

    return {
      answer,
      source: data.source || 'قاعدة معرفة المنصة',
      missed: Boolean(data.notFound) || answer === apiFallbackAnswer,
      images: normalizeAiImages(data.images),
      customType: normalizeAiCustomType(data.customType)
    };
  }catch(error){
    if(error?.name === 'AbortError'){
      const timeoutError = new Error('AI chat request timed out');
      timeoutError.userMessage = timeoutErrorDisplayAnswer;
      throw timeoutError;
    }
    throw error;
  }finally{
    window.clearTimeout(timeoutId);
  }
}

function normalizeAiCustomType(){
  return '';
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
  }catch{
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

async function copyAiText(text){
  if(navigator.clipboard?.writeText){
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function appendAiCopyButton(message, text){
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ai-copy-answer';
  button.textContent = 'نسخ الإجابة';
  button.addEventListener('click', async () => {
    try{
      await copyAiText(text);
      button.textContent = 'تم النسخ';
      window.setTimeout(() => { button.textContent = 'نسخ الإجابة'; }, 1400);
    }catch{
      button.textContent = 'تعذر النسخ';
      window.setTimeout(() => { button.textContent = 'نسخ الإجابة'; }, 1800);
    }
  });
  message.appendChild(button);
}

function addAiMessage(text, type = 'bot', source = '', missed = false, persist = true, images = [], customType = ''){
  const message = document.createElement('div');
  const safeImages = normalizeAiImages(images);
  const safeCustomType = type === 'bot' ? normalizeAiCustomType(customType) : '';
  message.className = `ai-message ${type}${missed ? ' is-missed' : ''}`;
  message.dataset.messageText = text;
  message.dataset.messageSource = source;
  if(safeCustomType) message.dataset.messageCustomType = safeCustomType;
  if(safeImages.length) message.dataset.messageImages = JSON.stringify(safeImages);
  message.textContent = text;
  appendAiImages(message, safeImages);
  if(type === 'bot' && source && text !== aiGreetingText) appendAiCopyButton(message, text);
  aiMessages.appendChild(message);
  aiMessages.scrollTop = aiMessages.scrollHeight;
  if(persist) persistAiConversation();
  return message;
}

function addMissedQuestionMessage(text = missedQuestionDisplayAnswer){
  addAiMessage(text, 'bot', 'قاعدة معرفة المنصة', true);
}

async function answerQuestion(question){
  addAiMessage(question, 'user');
  const loadingMessage = addAiMessage('جاري البحث في ملفات المنصة...', 'bot', '', false, false);
  loadingMessage.classList.add('ai-loading');
  loadingMessage.setAttribute('role', 'status');
  loadingMessage.setAttribute('aria-live', 'polite');
  loadingMessage.setAttribute('aria-atomic', 'true');
  try{
    const answer = await findAnswer(question);
    loadingMessage.remove();
    if(answer && !answer.missed){
      addAiMessage(answer.answer, 'bot', answer.source, false, true, answer.images, answer.customType);
      return;
    }
    addMissedQuestionMessage();
  }catch(error){
    loadingMessage.remove();
    const errorMessage = addAiMessage(error?.userMessage || temporaryErrorDisplayAnswer, 'bot', 'حالة الاتصال', false, false);
    errorMessage.classList.add('ai-error');
    errorMessage.setAttribute('role', 'alert');
    errorMessage.querySelector('.ai-copy-answer')?.remove();
  }finally{
    loadingMessage.remove();
  }
}

async function submitAiQuestion(question){
  const normalizedQuestion = String(question || '').trim();
  if(aiRequestPending) return;
  if(!normalizedQuestion){
    setAiFormStatus('اكتب سؤالًا قبل الإرسال.', true);
    aiQuestion.focus();
    return;
  }
  if(Array.from(normalizedQuestion).length > aiMaxQuestionLength){
    setAiFormStatus(invalidRequestDisplayAnswer, true);
    aiQuestion.focus();
    return;
  }

  setAiFormStatus();
  setAiRequestPending(true);
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
    setAiRequestPending(false);
    if(!isMobileAssistantView()) aiQuestion.focus();
  }
}

function addAiMobileHistoryEntry(){
  if(!isMobileAssistantView() || aiHistoryEntryActive) return;
  try{
    history.pushState({ ...history.state, aiAssistantOpen: true }, '');
    aiHistoryEntryActive = true;
  }catch{
    aiHistoryEntryActive = false;
  }
}

function openAiPanel(){
  aiPanel.hidden = false;
  aiToggle.setAttribute('aria-expanded', 'true');
  document.body.classList.add('ai-panel-open');
  aiPageScrollLocked = isMobileAssistantView();
  if(aiPageScrollLocked){
    aiPageScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.top = `-${aiPageScrollY}px`;
  }
  setAiPanelSessionState(true);
  addAiMobileHistoryEntry();
  renderAiKnowledgeCount();
  if(!aiMessages.querySelector('.ai-message')){
    addAiMessage(aiGreetingText, 'bot', aiGreetingSource);
  }
  if(aiSuggestions && !aiSuggestions.hidden){
    aiMessages.appendChild(aiSuggestions);
  }
  setAiFormStatus();
  if(!isMobileAssistantView()) aiQuestion.focus();
}

function closeAiPanel(options = {}){
  const shouldRemoveHistoryEntry = aiHistoryEntryActive && !options.fromHistory;
  aiPanel.hidden = true;
  aiToggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('ai-panel-open');
  setAiPanelSessionState(false);
  document.body.style.top = '';
  if(aiPageScrollLocked) window.scrollTo(0, aiPageScrollY);
  aiPageScrollLocked = false;
  if(shouldRemoveHistoryEntry){
    aiHistoryEntryActive = false;
    history.back();
  }
  if(!options.fromHistory) aiToggle.focus({ preventScroll: true });
}

aiToggle?.addEventListener('click', () => {
  aiPanel.hidden ? openAiPanel() : closeAiPanel();
});

aiClose?.addEventListener('click', closeAiPanel);

aiForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  await submitAiQuestion(aiQuestion.value);
});

aiQuestion?.addEventListener('keydown', (event) => {
  if(event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  aiForm.requestSubmit();
});

aiQuestion?.addEventListener('input', () => {
  if(aiFormStatus && !aiFormStatus.hidden) setAiFormStatus();
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('#aiSuggestions [data-question]');
  if(!button) return;
  await submitAiQuestion(button.textContent);
});

document.addEventListener('keydown', (event) => {
  if(event.key === 'Escape' && !aiPanel.hidden) closeAiPanel();
});

window.addEventListener('popstate', () => {
  if(!aiHistoryEntryActive || aiPanel.hidden) return;
  aiHistoryEntryActive = false;
  closeAiPanel({ fromHistory: true });
});

restoreAiConversation();
const restoredAiConversationStarted = Boolean(aiMessages.querySelector('.ai-message.user'));
setAiConversationStarted(restoredAiConversationStarted);
if(aiSuggestions) aiSuggestions.hidden = restoredAiConversationStarted;
if(wasAiPanelOpen()) openAiPanel();
