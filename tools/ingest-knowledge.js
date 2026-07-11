#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const KNOWLEDGE_PATH = path.join(ROOT_DIR, 'knowledge.md');
const OUT_DIR = path.join(ROOT_DIR, 'tmp');
const OUT_FILE = path.join(OUT_DIR, 'knowledge-vectors.ndjson');

const MODEL = '@cf/qwen/qwen3-embedding-0.6b';
const INDEX_NAME = 'school_knowledge_index';
const EXPECTED_DIMENSIONS = 1024;
const MAX_CHARS_PER_CHUNK = 1600;
const EMBEDDING_BATCH_SIZE = 20;

function printUsage(){
  console.log('Usage:');
  console.log('  node tools/ingest-knowledge.js --preview');
  console.log('  node tools/ingest-knowledge.js --upload');
}

function slugify(value){
  return String(value || 'section')
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'section';
}

function splitLongText(text, maxChars){
  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks = [];
  let current = '';

  for(const paragraph of paragraphs){
    if(!current){
      current = paragraph;
      continue;
    }

    if((current + '\n\n' + paragraph).length <= maxChars){
      current += '\n\n' + paragraph;
      continue;
    }

    chunks.push(current);
    current = paragraph;
  }

  if(current){
    chunks.push(current);
  }

  return chunks.flatMap((chunk) => {
    if(chunk.length <= maxChars){
      return [chunk];
    }

    const forced = [];
    for(let index = 0; index < chunk.length; index += maxChars){
      forced.push(chunk.slice(index, index + maxChars).trim());
    }
    return forced.filter(Boolean);
  });
}

function buildChunks(markdown){
  const sections = [];
  let currentParent = '';
  const matches = [...markdown.matchAll(/^(#{2,3})\s+(.+)$/gm)]
    .filter((match) => {
      const level = match[1].length;
      const title = match[2].trim();
      if(level === 2){
        currentParent = title;
        return true;
      }
      return currentParent !== 'أسئلة شائعة';
    });

  if(!matches.length){
    return splitLongText(markdown, MAX_CHARS_PER_CHUNK).map((text, index) => ({
      id: `k_${String(index + 1).padStart(4, '0')}`,
      text,
      metadata: {
        source: 'knowledge.md',
        section: 'قاعدة المعرفة'
      }
    }));
  }

  for(let index = 0; index < matches.length; index += 1){
    const match = matches[index];
    const title = match[2].trim();
    const start = match.index;
    const end = matches[index + 1]?.index ?? markdown.length;
    const sectionText = markdown.slice(start, end).trim();

    for(const [partIndex, text] of splitLongText(sectionText, MAX_CHARS_PER_CHUNK).entries()){
      const chunkText = text.startsWith('#') ? text : `${match[0]}\n\n${text}`;
      sections.push({
        id: `${slugify(title)}-${partIndex + 1}`,
        text: chunkText,
        metadata: {
          source: 'knowledge.md',
          section: title
        }
      });
    }
  }

  return sections.map((chunk, index) => ({
    ...chunk,
    id: `k_${String(index + 1).padStart(4, '0')}`
  }));
}

function extractEmbeddings(payload){
  const data =
    payload?.result?.data ??
    payload?.result?.embeddings ??
    payload?.data ??
    payload?.embeddings;

  if(Array.isArray(data) && Array.isArray(data[0])){
    return data;
  }

  if(Array.isArray(data) && Array.isArray(data[0]?.embedding)){
    return data.map((item) => item.embedding);
  }

  throw new Error('تعذر قراءة embeddings من استجابة Workers AI.');
}

async function createEmbeddings(texts){
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if(!accountId || !apiToken){
    throw new Error('يلزم ضبط CLOUDFLARE_ACCOUNT_ID و CLOUDFLARE_API_TOKEN قبل تشغيل السكربت.');
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text: texts })
  });

  const payload = await response.json();
  if(!response.ok || payload?.success === false){
    throw new Error(`Workers AI embedding failed: ${JSON.stringify(payload).slice(0, 1200)}`);
  }

  return extractEmbeddings(payload);
}

async function main(){
  const mode = process.argv[2];
  if(mode !== '--preview' && mode !== '--upload'){
    printUsage();
    return;
  }

  if(!fs.existsSync(KNOWLEDGE_PATH)){
    throw new Error(`لم يتم العثور على الملف: ${KNOWLEDGE_PATH}`);
  }

  const markdown = fs.readFileSync(KNOWLEDGE_PATH, "utf8");
  const chunks = buildChunks(markdown);
  if(!chunks.length){
    throw new Error('لم يتم إنشاء أي chunk من knowledge.md.');
  }

  if(mode === '--preview'){
    console.log(`Chunks: ${chunks.length}`);
    chunks.slice(0, 5).forEach((chunk, index) => {
      const preview = chunk.text.replace(/\s+/g, ' ').slice(0, 160);
      console.log(`${index + 1}. ${chunk.metadata.section}: ${preview}${chunk.text.length > 160 ? '...' : ''}`);
    });
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const vectors = [];
  for(let index = 0; index < chunks.length; index += EMBEDDING_BATCH_SIZE){
    const batch = chunks.slice(index, index + EMBEDDING_BATCH_SIZE);
    const embeddings = await createEmbeddings(batch.map((chunk) => chunk.text));

    if(embeddings.length !== batch.length){
      throw new Error(`عدد embeddings لا يطابق عدد chunks في الدفعة ${index / EMBEDDING_BATCH_SIZE + 1}.`);
    }

    embeddings.forEach((values, batchIndex) => {
      if(!Array.isArray(values) || values.length !== EXPECTED_DIMENSIONS){
        throw new Error(`أبعاد embedding غير صحيحة: المتوقع ${EXPECTED_DIMENSIONS}، الفعلي ${values?.length}.`);
      }

      const chunk = batch[batchIndex];
      vectors.push({
        id: chunk.id,
        values,
        metadata: {
          ...chunk.metadata,
          text: chunk.text
        }
      });
    });

    console.log(`تم توليد embeddings لعدد ${Math.min(index + EMBEDDING_BATCH_SIZE, chunks.length)} من ${chunks.length} chunks.`);
  }

  fs.writeFileSync(
    OUT_FILE,
    vectors.map((vector) => JSON.stringify(vector)).join('\n') + '\n',
    "utf8"
  );

  console.log(`تم إنشاء ملف Vectorize: ${OUT_FILE}`);

  const wranglerArgs = [
    'wrangler@latest',
    'vectorize',
    'upsert',
    INDEX_NAME,
    '--file',
    OUT_FILE,
    '--batch-size',
    '500'
  ];

  const result = spawnSync('npx', wranglerArgs, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if(result.status !== 0){
    throw new Error('فشل رفع vectors إلى Cloudflare Vectorize عبر wrangler.');
  }

  console.log(`تم رفع ${vectors.length} vectors إلى ${INDEX_NAME}.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
