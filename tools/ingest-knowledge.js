#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  ID_STRATEGY,
  assertEnvironmentIdentityMatches,
  assignContentIds,
  buildCandidateManifest,
  buildStalePlan,
  createEnvironmentTarget,
  diffManifests,
  getDeletionSummary,
  parseManifestText,
  reconcileRemoteIds,
  requireBoundEnvironmentIdentity,
  sha256,
  validateDeletionConfirmation,
  validateManifest,
  validateStalePlan
} = require('./vectorize-lifecycle.js');

const ROOT_DIR = path.resolve(__dirname, '..');
const KNOWLEDGE_PATH = path.join(ROOT_DIR, 'knowledge.md');
const APPROVED_KNOWLEDGE_DIR = path.join(ROOT_DIR, 'knowledge-files', 'approved');
const OUT_DIR = path.join(ROOT_DIR, 'tmp');
const OUT_FILE = path.join(OUT_DIR, 'knowledge-vectors.ndjson');
const TEMP_OUT_FILE = `${OUT_FILE}.tmp`;
const PREVIOUS_OUT_FILE = path.join(OUT_DIR, 'knowledge-vectors.previous.ndjson');
const ACTIVE_MANIFEST_FILE = path.join(__dirname, 'vectorize-manifest.json');
const CANDIDATE_MANIFEST_FILE = path.join(OUT_DIR, 'knowledge-vector-manifest.json');
const STALE_IDS_FILE = path.join(OUT_DIR, 'knowledge-stale-vector-ids.json');
const UPLOAD_RECEIPT_FILE = path.join(OUT_DIR, 'knowledge-vector-upload-receipt.json');
const REMOTE_SNAPSHOT_FILE = path.join(OUT_DIR, 'knowledge-vector-remote-snapshot.json');
const PREVIOUS_MANIFEST_FILE = path.join(OUT_DIR, 'vectorize-manifest.previous.json');

const MODEL = '@cf/qwen/qwen3-embedding-0.6b';
const INDEX_NAME = 'school_knowledge_index';
const EXPECTED_DIMENSIONS = 1024;
const MAX_CHARS_PER_CHUNK = 1600;
const EMBEDDING_BATCH_SIZE = 20;
const DELETE_BATCH_SIZE = 100;
const MAX_VECTOR_ID_BYTES = 64;
const MAX_VECTOR_METADATA_BYTES = 10 * 1024;
const MAX_VECTOR_UPLOAD_BYTES = 100 * 1000 * 1000;
const REQUIRED_VECTOR_METADATA_FIELDS = [
  'source',
  'section',
  'text',
  'knowledge_version',
  'content_hash',
  'vector_id_strategy',
  'embedding_model'
];

function printUsage(){
  console.log('Usage:');
  console.log(
    '  Sensitive modes require CLOUDFLARE_ACCOUNT_ID and VECTORIZE_ENVIRONMENT.'
  );
  console.log('  node tools/ingest-knowledge.js --preview');
  console.log('  node tools/ingest-knowledge.js --export-vectors');
  console.log('  node tools/ingest-knowledge.js --upload');
  console.log('  node tools/ingest-knowledge.js --audit-remote');
  console.log(
    '  node tools/ingest-knowledge.js --delete-stale --confirm ' +
    '<candidate-manifest-fingerprint> [--confirm-full-replacement]'
  );
}

function displayPath(filePath){
  return path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
}

function getKnowledgeSources(){
  const sources = [];

  if(fs.existsSync(KNOWLEDGE_PATH)){
    sources.push(KNOWLEDGE_PATH);
  }

  if(fs.existsSync(APPROVED_KNOWLEDGE_DIR)){
    fs.readdirSync(APPROVED_KNOWLEDGE_DIR)
      .filter((name) => name.toLowerCase().endsWith('.md'))
      .sort((a, b) => a.localeCompare(b))
      .forEach((name) => {
        sources.push(path.join(APPROVED_KNOWLEDGE_DIR, name));
      });
  }

  return sources;
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

function buildChunks(markdown, sourcePath){
  const source = displayPath(sourcePath);
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
    return splitLongText(markdown, MAX_CHARS_PER_CHUNK).map((text) => ({
      text,
      metadata: {
        source,
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

    for(const text of splitLongText(sectionText, MAX_CHARS_PER_CHUNK)){
      const chunkText = text.startsWith('#') ? text : `${match[0]}\n\n${text}`;
      sections.push({
        text: chunkText,
        metadata: {
          source,
          section: title
        }
      });
    }
  }

  return sections;
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

function readJsonFile(filePath, label){
  if(!fs.existsSync(filePath)){
    throw new Error(`${label} غير موجود: ${displayPath(filePath)}`);
  }

  try{
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }catch{
    throw new Error(`${label} ليس JSON صالحًا: ${displayPath(filePath)}`);
  }
}

function atomicWriteJson(filePath, value){
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.rmSync(tempPath, { force: true });
  try{
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, filePath);
  }catch(error){
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

function assertManifestTarget(manifest, label){
  if(
    manifest.indexName !== INDEX_NAME ||
    manifest.embeddingModel !== MODEL ||
    manifest.dimensions !== EXPECTED_DIMENSIONS
  ){
    throw new Error(`${label} لا يطابق إعدادات Vectorize الحالية.`);
  }
}

function loadActiveManifest(){
  if(!fs.existsSync(ACTIVE_MANIFEST_FILE)){
    throw new Error(`Active manifest غير موجود: ${displayPath(ACTIVE_MANIFEST_FILE)}`);
  }

  const manifest = parseManifestText(
    fs.readFileSync(ACTIVE_MANIFEST_FILE, 'utf8'),
    'Active Vectorize manifest'
  );
  if(manifest.state !== 'active'){
    throw new Error('Active Vectorize manifest لا يحمل الحالة active.');
  }
  assertManifestTarget(manifest, 'Active Vectorize manifest');
  return manifest;
}

function resolveEnvironmentTarget(runtimeEnv = process.env){
  return createEnvironmentTarget({
    accountId: runtimeEnv.CLOUDFLARE_ACCOUNT_ID,
    environmentName: runtimeEnv.VECTORIZE_ENVIRONMENT
  });
}

function prepareKnowledgeState(environmentTarget = createEnvironmentTarget()){
  const sources = getKnowledgeSources();
  if(!sources.length){
    throw new Error(`لم يتم العثور على أي ملفات معرفة. أضف knowledge.md أو ملفات Markdown داخل ${APPROVED_KNOWLEDGE_DIR}.`);
  }

  const rawChunks = sources.flatMap((sourcePath) => {
    const markdown = fs.readFileSync(sourcePath, 'utf8');
    return buildChunks(markdown, sourcePath);
  });
  if(!rawChunks.length){
    throw new Error('لم يتم إنشاء أي chunk من ملفات المعرفة.');
  }

  const contentAddressedChunks = assignContentIds(rawChunks);
  const candidateManifest = buildCandidateManifest({
    chunks: contentAddressedChunks,
    indexName: INDEX_NAME,
    embeddingModel: MODEL,
    dimensions: EXPECTED_DIMENSIONS,
    environmentTarget
  });
  const chunks = contentAddressedChunks.map((chunk) => ({
    ...chunk,
    metadata: {
      ...chunk.metadata,
      knowledge_version: candidateManifest.knowledgeFingerprint,
      embedding_model: MODEL
    }
  }));

  return { sources, chunks, candidateManifest };
}

function writeLifecycleArtifacts(activeManifest, candidateManifest){
  const stalePlan = buildStalePlan(activeManifest, candidateManifest);
  atomicWriteJson(CANDIDATE_MANIFEST_FILE, candidateManifest);
  atomicWriteJson(STALE_IDS_FILE, stalePlan);
  return stalePlan;
}

function readVectorFileSummaryLegacy(filePath, validateValues = false){
  if(!fs.existsSync(filePath)){
    throw new Error(`ملف vectors غير موجود: ${displayPath(filePath)}`);
  }

  const lines = fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const ids = [];
  const metadataVersions = new Set();

  for(const [index, line] of lines.entries()){
    let vector;
    try{
      vector = JSON.parse(line);
    }catch{
      throw new Error(`سطر NDJSON رقم ${index + 1} غير صالح.`);
    }

    if(typeof vector.id !== 'string' || !vector.id){
      throw new Error(`Vector رقم ${index + 1} لا يحتوي ID صالحًا.`);
    }
    if(
      validateValues &&
      (!Array.isArray(vector.values) || vector.values.length !== EXPECTED_DIMENSIONS)
    ){
      throw new Error(`Vector ${vector.id} لا يطابق أبعاد ${EXPECTED_DIMENSIONS}.`);
    }
    if(validateValues){
      metadataVersions.add(String(vector.metadata?.knowledge_version || ''));
    }
    ids.push(vector.id);
  }

  if(new Set(ids).size !== ids.length){
    throw new Error('ملف vectors يحتوي IDs مكررة.');
  }

  return { count: ids.length, ids: ids.sort(), metadataVersions };
}

function readVectorFileSummary(filePath, options = false){
  if(!fs.existsSync(filePath)){
    throw new Error(`Vector file is missing: ${displayPath(filePath)}`);
  }
  const fileSize = fs.statSync(filePath).size;
  if(fileSize > MAX_VECTOR_UPLOAD_BYTES){
    throw new Error(
      `Vector NDJSON exceeds the ${MAX_VECTOR_UPLOAD_BYTES} byte upload limit.`
    );
  }

  const normalizedOptions = options === true
    ? { validateValues: true, candidateManifest: null }
    : (
        options && typeof options === 'object' && !Array.isArray(options)
          ? {
              validateValues: options.validateValues === true,
              candidateManifest: options.candidateManifest || null
            }
          : { validateValues: false, candidateManifest: null }
      );
  if(!normalizedOptions.validateValues){
    return {
      ...readVectorFileSummaryLegacy(filePath),
      fileSize
    };
  }

  const candidateManifest = normalizedOptions.candidateManifest
    ? validateManifest(
        normalizedOptions.candidateManifest,
        'Candidate Vectorize manifest'
      )
    : null;
  const lines = fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const ids = [];
  const metadataVersions = new Set();

  for(const [index, line] of lines.entries()){
    let vector;
    try{
      vector = JSON.parse(line);
    }catch{
      throw new Error(`NDJSON line ${index + 1} is invalid JSON.`);
    }

    if(typeof vector.id !== 'string' || !vector.id.trim()){
      throw new Error(`Vector at line ${index + 1} has an invalid ID.`);
    }
    const id = vector.id.trim();
    if(
      Buffer.byteLength(id, 'utf8') > MAX_VECTOR_ID_BYTES ||
      !/^[A-Za-z0-9_-]+$/.test(id)
    ){
      throw new Error(`Vector ID at line ${index + 1} is invalid.`);
    }
    if(!Array.isArray(vector.values) || vector.values.length !== EXPECTED_DIMENSIONS){
      throw new Error(`Vector ${id} does not have ${EXPECTED_DIMENSIONS} dimensions.`);
    }
    if(vector.values.some(
      (value) => typeof value !== 'number' || !Number.isFinite(value)
    )){
      throw new Error(`Vector ${id} contains a non-finite numeric value.`);
    }
    if(
      !vector.metadata ||
      typeof vector.metadata !== 'object' ||
      Array.isArray(vector.metadata)
    ){
      throw new Error(`Vector ${id} metadata is invalid.`);
    }
    for(const field of REQUIRED_VECTOR_METADATA_FIELDS){
      if(
        typeof vector.metadata[field] !== 'string' ||
        !vector.metadata[field].trim()
      ){
        throw new Error(`Vector ${id} metadata field ${field} is invalid.`);
      }
    }

    const metadataBytes = Buffer.byteLength(
      JSON.stringify(vector.metadata),
      'utf8'
    );
    if(metadataBytes > MAX_VECTOR_METADATA_BYTES){
      throw new Error(
        `Vector ${id} metadata exceeds ${MAX_VECTOR_METADATA_BYTES} bytes.`
      );
    }
    if(vector.metadata.content_hash !== sha256(vector.metadata.text)){
      throw new Error(`Vector ${id} content fingerprint is invalid.`);
    }
    if(vector.metadata.vector_id_strategy !== ID_STRATEGY){
      throw new Error(`Vector ${id} ID algorithm version is invalid.`);
    }

    const expectedId = assignContentIds([{
      text: vector.metadata.text,
      metadata: {
        source: vector.metadata.source,
        section: vector.metadata.section
      }
    }])[0].id;
    if(id !== expectedId){
      throw new Error(`Vector ${id} does not match its content identity.`);
    }

    metadataVersions.add(vector.metadata.knowledge_version);
    if(
      candidateManifest &&
      (
        vector.metadata.knowledge_version !== candidateManifest.knowledgeFingerprint ||
        vector.metadata.vector_id_strategy !== candidateManifest.idStrategy ||
        vector.metadata.embedding_model !== candidateManifest.embeddingModel
      )
    ){
      throw new Error(`Vector ${id} metadata does not match the candidate manifest.`);
    }
    ids.push(id);
  }

  if(new Set(ids).size !== ids.length){
    throw new Error('Vector NDJSON contains duplicate IDs.');
  }
  if(candidateManifest){
    if(ids.length !== candidateManifest.vectorCount){
      throw new Error('Vector NDJSON count does not match the candidate manifest.');
    }
    if(!sameIds(ids, candidateManifest.ids)){
      throw new Error('Vector NDJSON IDs do not exactly match the candidate manifest.');
    }
  }

  return {
    count: ids.length,
    ids: ids.sort(),
    metadataVersions,
    fileSize
  };
}

function sameIds(left, right){
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function prepareVectorBackup(activeManifest, candidateManifest){
  if(!fs.existsSync(OUT_FILE)){
    return;
  }

  const existing = readVectorFileSummary(OUT_FILE);
  if(sameIds(existing.ids, activeManifest.ids)){
    fs.copyFileSync(OUT_FILE, PREVIOUS_OUT_FILE);
    return;
  }
  if(sameIds(existing.ids, candidateManifest.ids)){
    return;
  }

  throw new Error(
    'ملف vectors الحالي لا يطابق active manifest ولا candidate manifest؛ أوقفت العملية لحماية ملفات rollback.'
  );
}

function loadCandidateArtifacts(activeManifest, freshCandidateManifest){
  const candidate = validateManifest(
    readJsonFile(CANDIDATE_MANIFEST_FILE, 'Candidate manifest'),
    'Candidate Vectorize manifest'
  );
  assertManifestTarget(candidate, 'Candidate Vectorize manifest');
  if(
    candidate.manifestFingerprint !== freshCandidateManifest.manifestFingerprint ||
    candidate.knowledgeFingerprint !== freshCandidateManifest.knowledgeFingerprint
  ){
    throw new Error('Candidate manifest لا يطابق ملفات المعرفة الحالية.');
  }
  assertEnvironmentIdentityMatches(
    candidate.environmentIdentity,
    freshCandidateManifest.environmentIdentity,
    'Candidate manifest'
  );

  const stalePlan = validateStalePlan(
    readJsonFile(STALE_IDS_FILE, 'Stale IDs plan'),
    activeManifest,
    candidate
  );
  const vectors = readVectorFileSummary(OUT_FILE, {
    validateValues: true,
    candidateManifest: candidate
  });
  if(!sameIds(vectors.ids, candidate.ids) || vectors.count !== candidate.vectorCount){
    throw new Error('ملف NDJSON لا يطابق candidate manifest.');
  }
  if(
    vectors.metadataVersions.size !== 1 ||
    !vectors.metadataVersions.has(candidate.knowledgeFingerprint)
  ){
    throw new Error('Metadata إصدار المعرفة في NDJSON لا تطابق candidate manifest.');
  }

  return { candidate, stalePlan, vectors };
}

function writeUploadReceipt(candidateManifest){
  atomicWriteJson(UPLOAD_RECEIPT_FILE, {
    schemaVersion: 1,
    indexName: INDEX_NAME,
    candidateManifestFingerprint: candidateManifest.manifestFingerprint,
    candidateKnowledgeFingerprint: candidateManifest.knowledgeFingerprint,
    environmentIdentity: candidateManifest.environmentIdentity,
    createdAt: new Date().toISOString(),
    uploadedVectorCount: candidateManifest.vectorCount
  });
}

function validateUploadReceiptData(receipt, candidateManifest){
  if(!receipt || typeof receipt !== 'object' || Array.isArray(receipt)){
    throw new Error('Upload receipt is missing or invalid.');
  }
  if(typeof receipt.createdAt !== 'string' || Number.isNaN(Date.parse(receipt.createdAt))){
    throw new Error('Upload receipt timestamp is invalid.');
  }
  assertEnvironmentIdentityMatches(
    receipt.environmentIdentity,
    candidateManifest.environmentIdentity,
    'Upload receipt'
  );
  if(
    receipt.schemaVersion !== 1 ||
    receipt.indexName !== INDEX_NAME ||
    receipt.candidateManifestFingerprint !== candidateManifest.manifestFingerprint ||
    receipt.candidateKnowledgeFingerprint !== candidateManifest.knowledgeFingerprint ||
    receipt.uploadedVectorCount !== candidateManifest.vectorCount
  ){
    throw new Error('Upload receipt لا يطابق candidate manifest الحالي.');
  }
  return receipt;
}

function validateUploadReceipt(candidateManifest){
  return validateUploadReceiptData(
    readJsonFile(UPLOAD_RECEIPT_FILE, 'Upload receipt'),
    candidateManifest
  );
}

function runWrangler(args, failureMessage, spawn = spawnSync){
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawn(command, ['wrangler@latest', ...args], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: false
  });

  if(result.status !== 0){
    throw new Error(failureMessage);
  }
}

function runWranglerJson(args, failureMessage, spawn = spawnSync){
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawn(command, ['wrangler@latest', ...args], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if(result.status !== 0){
    throw new Error(failureMessage);
  }

  try{
    return JSON.parse(String(result.stdout || ''));
  }catch{
    throw new Error('تعذر قراءة استجابة JSON من Wrangler دون حفظ لقطة بعيدة.');
  }
}

function extractVectorListPage(payload){
  const page = payload?.result ?? payload;
  if(
    !page ||
    !Array.isArray(page.vectors) ||
    !Number.isInteger(page.count) ||
    !Number.isInteger(page.totalCount) ||
    typeof page.isTruncated !== 'boolean'
  ){
    throw new Error('استجابة list-vectors لا تطابق البنية المتوقعة.');
  }

  const ids = page.vectors.map((vector, index) => {
    if(typeof vector?.id !== 'string' || !vector.id){
      throw new Error(`استجابة list-vectors تحتوي ID غير صالح في الموضع ${index + 1}.`);
    }
    return vector.id;
  });
  if(ids.length !== page.count){
    throw new Error('عدد IDs في استجابة list-vectors لا يطابق count.');
  }
  if(page.isTruncated && (typeof page.nextCursor !== 'string' || !page.nextCursor)){
    throw new Error('استجابة list-vectors المقتطعة لا تحتوي nextCursor صالحًا.');
  }

  return {
    ids,
    totalCount: page.totalCount,
    isTruncated: page.isTruncated,
    nextCursor: page.nextCursor || ''
  };
}

function validateRemoteSnapshotData(
  snapshot,
  activeManifest,
  candidateManifest,
  stalePlan
){
  if(!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)){
    throw new Error('Remote Vectorize snapshot is missing or invalid.');
  }
  if(typeof snapshot.createdAt !== 'string' || Number.isNaN(Date.parse(snapshot.createdAt))){
    throw new Error('Remote Vectorize snapshot timestamp is invalid.');
  }
  assertEnvironmentIdentityMatches(
    snapshot.environmentIdentity,
    candidateManifest.environmentIdentity,
    'Remote Vectorize snapshot'
  );
  if(
    snapshot.schemaVersion !== 1 ||
    snapshot.indexName !== INDEX_NAME ||
    snapshot.baseManifestFingerprint !== activeManifest.manifestFingerprint ||
    snapshot.candidateManifestFingerprint !== candidateManifest.manifestFingerprint ||
    snapshot.candidateKnowledgeFingerprint !== candidateManifest.knowledgeFingerprint ||
    snapshot.remoteCount !== snapshot.ids?.length
  ){
    throw new Error('Remote Vectorize snapshot لا يطابق دورة المعرفة الحالية.');
  }

  return reconcileRemoteIds({
    remoteIds: snapshot.ids,
    activeManifest,
    candidateManifest,
    stalePlan
  });
}

function loadRemoteSnapshot(activeManifest, candidateManifest, stalePlan){
  return validateRemoteSnapshotData(
    readJsonFile(REMOTE_SNAPSHOT_FILE, 'Remote Vectorize snapshot'),
    activeManifest,
    candidateManifest,
    stalePlan
  );
}

function auditRemoteVectors({
  activeManifest,
  freshCandidateManifest,
  spawn,
  log
}){
  const artifacts = loadCandidateArtifacts(activeManifest, freshCandidateManifest);
  validateUploadReceipt(artifacts.candidate);

  const ids = [];
  let cursor = '';
  let expectedTotalCount = null;
  for(let pageNumber = 1; pageNumber <= 100; pageNumber += 1){
    const wranglerArgs = [
      'vectorize',
      'list-vectors',
      INDEX_NAME,
      '--count',
      '1000',
      '--json'
    ];
    if(cursor){
      wranglerArgs.push('--cursor', cursor);
    }

    const page = extractVectorListPage(runWranglerJson(
      wranglerArgs,
      'فشل التدقيق القرائي لمعرّفات Vectorize عبر Wrangler.',
      spawn
    ));
    if(expectedTotalCount === null){
      expectedTotalCount = page.totalCount;
    }else if(page.totalCount !== expectedTotalCount){
      throw new Error('تغيّر totalCount بين صفحات لقطة Vectorize؛ لم يتم حفظ اللقطة.');
    }
    ids.push(...page.ids);
    log(`تمت قراءة صفحة Vectorize رقم ${pageNumber} بعدد ${page.ids.length} IDs.`);

    if(!page.isTruncated){
      if(ids.length !== expectedTotalCount){
        throw new Error('إجمالي IDs المقروءة لا يطابق totalCount؛ لم يتم حفظ اللقطة.');
      }
      const reconciliation = reconcileRemoteIds({
        remoteIds: ids,
        activeManifest,
        candidateManifest: artifacts.candidate,
        stalePlan: artifacts.stalePlan
      });
      atomicWriteJson(REMOTE_SNAPSHOT_FILE, {
        schemaVersion: 1,
        indexName: INDEX_NAME,
        baseManifestFingerprint: activeManifest.manifestFingerprint,
        candidateManifestFingerprint: artifacts.candidate.manifestFingerprint,
        candidateKnowledgeFingerprint: artifacts.candidate.knowledgeFingerprint,
        environmentIdentity: artifacts.candidate.environmentIdentity,
        createdAt: new Date().toISOString(),
        remoteCount: reconciliation.remoteCount,
        ids: reconciliation.remoteIds
      });
      log(`تم حفظ لقطة التدقيق القرائية: ${displayPath(REMOTE_SNAPSHOT_FILE)}`);
      log(`Stale IDs الموجودة فعليًا والمتوقّع حذفها: ${reconciliation.deletableStaleIds.length}`);
      log(`Stale IDs غير الموجودة أصلًا: ${reconciliation.alreadyAbsentStaleIds.length}`);
      log('لم ينفذ audit أي رفع أو حذف في Vectorize.');
      return {
        mode: '--audit-remote',
        vectorCount: artifacts.candidate.vectorCount,
        staleCount: reconciliation.deletableStaleIds.length,
        remoteCount: reconciliation.remoteCount,
        cloudMutation: false
      };
    }
    cursor = page.nextCursor;
  }

  throw new Error('تجاوز تدقيق Vectorize حد 100 صفحة؛ لم يتم حفظ لقطة بعيدة.');
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
    throw new Error('Workers AI embedding request failed. راجع الصلاحيات والحالة من Cloudflare دون طباعة الاستجابة الحساسة.');
  }

  return extractEmbeddings(payload);
}

async function generateVectorFile(
  chunks,
  activeManifest,
  candidateManifest,
  embeddingGenerator = createEmbeddings
){
  fs.mkdirSync(OUT_DIR, { recursive: true });
  prepareVectorBackup(activeManifest, candidateManifest);
  fs.rmSync(TEMP_OUT_FILE, { force: true });

  try{
    const vectors = [];
    for(let index = 0; index < chunks.length; index += EMBEDDING_BATCH_SIZE){
      const batch = chunks.slice(index, index + EMBEDDING_BATCH_SIZE);
      const embeddings = await embeddingGenerator(batch.map((chunk) => chunk.text));

      if(embeddings.length !== batch.length){
        throw new Error(`عدد embeddings لا يطابق عدد chunks في الدفعة ${index / EMBEDDING_BATCH_SIZE + 1}.`);
      }

      embeddings.forEach((values, batchIndex) => {
        if(
          !Array.isArray(values) ||
          values.length !== EXPECTED_DIMENSIONS ||
          values.some((value) => typeof value !== 'number' || !Number.isFinite(value))
        ){
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
      TEMP_OUT_FILE,
      vectors.map((vector) => JSON.stringify(vector)).join('\n') + '\n',
      'utf8'
    );
    fs.renameSync(TEMP_OUT_FILE, OUT_FILE);
    return vectors;
  }catch(error){
    fs.rmSync(TEMP_OUT_FILE, { force: true });
    throw new Error(`فشل توليد ملف vectors: ${error.message || error}`, {
      cause: error
    });
  }
}

function printPreview({
  sources,
  chunks,
  activeManifest,
  candidateManifest,
  diff,
  log
}){
  log(`Knowledge files: ${sources.length}`);
  sources.forEach((sourcePath) => {
    log(`- ${displayPath(sourcePath)}`);
  });
  log(`Chunks: ${chunks.length}`);
  log(`Active manifest vectors: ${activeManifest.vectorCount}`);
  log(`Candidate vectors: ${candidateManifest.vectorCount}`);
  log(`Retained IDs: ${diff.retainedIds.length}`);
  log(`New IDs: ${diff.newIds.length}`);
  log(`Stale IDs planned for explicit deletion: ${diff.staleIds.length}`);
  log(`Candidate manifest: ${displayPath(CANDIDATE_MANIFEST_FILE)}`);
  log(`Stale IDs file: ${displayPath(STALE_IDS_FILE)}`);
  log('Preview mode performs no Vectorize upload or delete.');

  chunks.slice(0, 5).forEach((chunk, index) => {
    const preview = chunk.text.replace(/\s+/g, ' ').slice(0, 160);
    log(`${index + 1}. [${chunk.metadata.source}] ${chunk.metadata.section}: ${preview}${chunk.text.length > 160 ? '...' : ''}`);
  });
}

function promoteCandidateManifest(candidateManifest){
  const currentActive = fs.readFileSync(ACTIVE_MANIFEST_FILE, 'utf8');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(PREVIOUS_MANIFEST_FILE, currentActive, 'utf8');
  atomicWriteJson(ACTIVE_MANIFEST_FILE, {
    ...candidateManifest,
    state: 'active'
  });
}

async function deleteStaleVectors({
  args,
  activeManifest,
  freshCandidateManifest,
  spawn,
  log
}){
  const confirmIndex = args.indexOf('--confirm');
  const confirmation = confirmIndex >= 0 ? String(args[confirmIndex + 1] || '') : '';
  const confirmFullReplacement = args.includes('--confirm-full-replacement');
  const artifacts = loadCandidateArtifacts(activeManifest, freshCandidateManifest);
  requireBoundEnvironmentIdentity(
    artifacts.candidate.environmentIdentity,
    'Candidate manifest environment identity'
  );
  validateUploadReceipt(artifacts.candidate);
  const reconciliation = loadRemoteSnapshot(
    activeManifest,
    artifacts.candidate,
    artifacts.stalePlan
  );

  const deletionSummary = getDeletionSummary(
    activeManifest,
    artifacts.candidate,
    artifacts.stalePlan
  );
  log(`Active vectors: ${deletionSummary.activeCount}`);
  log(`Candidate vectors: ${deletionSummary.candidateCount}`);
  log(`Stale vectors: ${deletionSummary.staleCount}`);
  log(`Deletion ratio: ${(deletionSummary.deletionRatio * 100).toFixed(2)}%`);
  validateDeletionConfirmation({
    activeManifest,
    candidateManifest: artifacts.candidate,
    stalePlan: artifacts.stalePlan,
    confirmation,
    confirmFullReplacement
  });

  for(let index = 0; index < reconciliation.deletableStaleIds.length; index += DELETE_BATCH_SIZE){
    const batch = reconciliation.deletableStaleIds.slice(index, index + DELETE_BATCH_SIZE);
    runWrangler(
      [
        'vectorize',
        'delete-vectors',
        INDEX_NAME,
        '--ids',
        ...batch
      ],
      'فشل حذف دفعة stale IDs من Vectorize. لم يتم ترقية active manifest.',
      spawn
    );
    log(
      `تم حذف دفعة stale IDs رقم ${Math.floor(index / DELETE_BATCH_SIZE) + 1} ` +
      `بعدد ${batch.length}.`
    );
  }

  promoteCandidateManifest(artifacts.candidate);
  fs.rmSync(UPLOAD_RECEIPT_FILE, { force: true });
  fs.rmSync(REMOTE_SNAPSHOT_FILE, { force: true });
  log(`تمت ترقية active manifest إلى ${artifacts.candidate.manifestFingerprint}.`);
  return {
    mode: '--delete-stale',
    vectorCount: artifacts.candidate.vectorCount,
    staleCount: reconciliation.deletableStaleIds.length,
    cloudMutation: reconciliation.deletableStaleIds.length > 0
  };
}

async function main(
  args = process.argv.slice(2),
  {
    embeddingGenerator = createEmbeddings,
    spawn = spawnSync,
    log = console.log,
    runtimeEnv = process.env
  } = {}
){
  const mode = args[0];
  const supportedModes = new Set([
    '--preview',
    '--export-vectors',
    '--upload',
    '--audit-remote',
    '--delete-stale'
  ]);
  if(!supportedModes.has(mode)){
    printUsage();
    return { mode: 'usage', cloudMutation: false };
  }

  const environmentTarget = resolveEnvironmentTarget(runtimeEnv);
  const activeManifest = loadActiveManifest();
  const { sources, chunks, candidateManifest } = prepareKnowledgeState(
    environmentTarget
  );
  if(mode !== '--preview'){
    requireBoundEnvironmentIdentity(
      candidateManifest.environmentIdentity,
      'Current Vectorize environment identity'
    );
  }
  const diff = diffManifests(activeManifest, candidateManifest);

  if(mode === '--delete-stale'){
    return deleteStaleVectors({
      args,
      activeManifest,
      freshCandidateManifest: candidateManifest,
      spawn,
      log
    });
  }

  if(mode === '--audit-remote'){
    return auditRemoteVectors({
      activeManifest,
      freshCandidateManifest: candidateManifest,
      spawn,
      log
    });
  }

  if(mode === '--upload'){
    const artifacts = loadCandidateArtifacts(activeManifest, candidateManifest);
    requireBoundEnvironmentIdentity(
      artifacts.candidate.environmentIdentity,
      'Candidate manifest environment identity'
    );
    printPreview({
      sources,
      chunks,
      activeManifest,
      candidateManifest: artifacts.candidate,
      diff,
      log
    });
    runWrangler(
      [
        'vectorize',
        'upsert',
        INDEX_NAME,
        '--file',
        OUT_FILE,
        '--batch-size',
        '500'
      ],
      'Vectorize upload failed through Wrangler.',
      spawn
    );
    writeUploadReceipt(artifacts.candidate);
    log(`Uploaded ${artifacts.vectors.count} vectors without deleting stale IDs.`);
    log('Run the remote audit before any stale deletion.');
    log(
      'After a successful audit, run: ' +
      `node tools/ingest-knowledge.js --delete-stale --confirm ` +
      `${artifacts.candidate.manifestFingerprint}` +
      (
        artifacts.stalePlan.staleCount / activeManifest.vectorCount > 0.5
          ? ' --confirm-full-replacement'
          : ''
      )
    );
    return {
      mode,
      vectorCount: artifacts.vectors.count,
      staleCount: artifacts.stalePlan.staleCount,
      cloudMutation: true
    };
  }

  const stalePlan = writeLifecycleArtifacts(activeManifest, candidateManifest);
  printPreview({
    sources,
    chunks,
    activeManifest,
    candidateManifest,
    diff,
    log
  });

  if(mode === '--preview'){
    return {
      mode,
      sourceCount: sources.length,
      vectorCount: chunks.length,
      staleCount: stalePlan.staleCount,
      cloudMutation: false
    };
  }

  const vectors = await generateVectorFile(
    chunks,
    activeManifest,
    candidateManifest,
    embeddingGenerator
  );
  loadCandidateArtifacts(activeManifest, candidateManifest);
  log(`تم إنشاء ملف Vectorize: ${displayPath(OUT_FILE)}`);
  log(`عدد vectors المولّدة: ${vectors.length}`);

  if(mode === '--export-vectors'){
    log('تم التصدير فقط دون رفع أو حذف أي vectors في Vectorize.');
    return {
      mode,
      vectorCount: vectors.length,
      staleCount: stalePlan.staleCount,
      cloudMutation: false
    };
  }

  throw new Error(`Unsupported local lifecycle mode: ${mode}`);
}

if(require.main === module){
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  buildChunks,
  generateVectorFile,
  getKnowledgeSources,
  main,
  prepareKnowledgeState,
  readVectorFileSummary,
  resolveEnvironmentTarget,
  validateRemoteSnapshotData,
  validateUploadReceiptData
};
