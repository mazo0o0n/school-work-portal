const FALLBACK_ANSWER = 'ما عندي معلومة مؤكدة عن هذا السؤال حاليًا، تقدر تعيد صياغته أو تراجع الجهة المختصة.';
const ASSISTANT_ERROR = 'حدث خطأ أثناء تشغيل المساعد. حاول مرة أخرى بعد قليل.';

const SYSTEM_PROMPT = [
  'أنت مساعد منصة التنظيم المدرسي والموارد التعليمية.',
  'أجب باللغة العربية فقط وبأسلوب واضح ومختصر.',
  'استخدم المعلومات المسترجعة من قاعدة معرفة المنصة فقط.',
  'لا تخترع أي إجابة ولا تستخدم معرفة عامة خارج الملفات المتاحة.',
  `إذا لم تجد معلومة مؤكدة، أرجع النص التالي حرفيًا: "${FALLBACK_ANSWER}"`
].join('\n');

function jsonResponse(body, status = 200){
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function extractResponseText(data){
  if(typeof data?.output_text === 'string' && data.output_text.trim()){
    return data.output_text.trim();
  }

  const chunks = [];
  for(const item of data?.output || []){
    for(const part of item?.content || []){
      if(typeof part?.text === 'string'){
        chunks.push(part.text);
      }
    }
  }

  return chunks.join('\n').trim();
}

function hasFileSearchResults(data){
  return (data.output || []).some((item) => {
    return item.type === 'file_search_call' &&
      Array.isArray(item.results) &&
      item.results.length > 0;
  });
}

async function handleChat(request, env){
  let payload;
  try{
    payload = await request.json();
  }catch(_){
    return jsonResponse({ answer: FALLBACK_ANSWER, notFound: true }, 400);
  }

  const question = String(payload?.message || payload?.question || '').trim();
  if(!question){
    return jsonResponse({ answer: FALLBACK_ANSWER, notFound: true }, 400);
  }

  const apiKey = env.OPENAI_API_KEY;
  const vectorStoreId = env.OPENAI_VECTOR_STORE_ID;
  const model = env.OPENAI_MODEL || 'gpt-4.1-mini';

  if(!apiKey || !vectorStoreId){
    return jsonResponse({ answer: FALLBACK_ANSWER, notFound: true }, 500);
  }

  let openAiResponse;
  try{
    openAiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        instructions: SYSTEM_PROMPT,
        input: question,
        tools: [
          {
            type: 'file_search',
            vector_store_ids: [vectorStoreId],
            max_num_results: 5
          }
        ],
        tool_choice: 'required',
        include: ['file_search_call.results'],
        max_output_tokens: 600
      })
    });
  }catch(error){
    console.error('OpenAI request failed:', error?.message || error);
    if(env.DEBUG_CHAT === 'true'){
      return jsonResponse({
        answer: ASSISTANT_ERROR,
        debug: {
          type: 'openai_request_failed',
          message: String(error?.message || error).slice(0, 1000)
        },
        notFound: true
      }, 502);
    }

    return jsonResponse({ answer: ASSISTANT_ERROR, notFound: true }, 502);
  }

  if(!openAiResponse.ok){
    const errorText = await openAiResponse.text();
    console.error('OpenAI API error:', {
      status: openAiResponse.status,
      body: errorText.slice(0, 1000)
    });
    if(env.DEBUG_CHAT === 'true'){
      return jsonResponse({
        answer: ASSISTANT_ERROR,
        debug: {
          type: 'openai_api_error',
          status: openAiResponse.status,
          body: errorText.slice(0, 1500)
        },
        notFound: true
      }, 502);
    }

    return jsonResponse({ answer: ASSISTANT_ERROR, notFound: true }, 502);
  }

  const data = await openAiResponse.json();
  console.log('OpenAI debug:', {
    id: data.id,
    outputTypes: (data.output || []).map(item => item.type),
    fileSearchCalls: (data.output || [])
      .filter(item => item.type === 'file_search_call')
      .map(item => ({
        status: item.status,
        resultsCount: Array.isArray(item.results) ? item.results.length : null
      })),
    outputTextPreview: typeof data.output_text === 'string' ? data.output_text.slice(0, 300) : null
  });

  if(!hasFileSearchResults(data)){
    return jsonResponse({
      answer: FALLBACK_ANSWER,
      source: 'قاعدة معرفة المنصة',
      notFound: true
    });
  }

  const answer = extractResponseText(data) || FALLBACK_ANSWER;

  return jsonResponse({
    answer,
    source: answer === FALLBACK_ANSWER ? 'قاعدة معرفة المنصة' : 'ملفات قاعدة المعرفة',
    notFound: answer === FALLBACK_ANSWER
  });
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);

    if(url.pathname === '/api/chat'){
      if(request.method !== 'POST'){
        return jsonResponse({ error: 'Method not allowed' }, 405);
      }

      return handleChat(request, env);
    }

    if(url.pathname.startsWith('/api/')){
      return jsonResponse({ error: 'Not found' }, 404);
    }

    return env.ASSETS.fetch(request);
  }
};
