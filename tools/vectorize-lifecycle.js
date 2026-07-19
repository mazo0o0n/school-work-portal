const crypto = require('node:crypto');

const MANIFEST_SCHEMA_VERSION = 1;
const ID_STRATEGY = 'source-section-content-sha256-v1';
const ENVIRONMENT_IDENTITY_SCHEMA_VERSION = 1;
const MAX_VECTOR_ID_BYTES = 64;
const MAX_MANIFEST_IDS = 100000;
const HIGH_RISK_DELETION_RATIO = 0.5;

function sha256(value){
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function isPlainObject(value){
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertNonEmptyString(value, label){
  if(typeof value !== 'string' || !value.trim()){
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertTimestamp(value, label){
  const timestamp = assertNonEmptyString(value, label);
  if(Number.isNaN(Date.parse(timestamp))){
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return timestamp;
}

function createEnvironmentTarget({
  accountId = '',
  environmentName = ''
} = {}){
  const normalizedAccountId = String(accountId || '').trim();
  const normalizedEnvironmentName = String(environmentName || '').trim();
  if(Boolean(normalizedAccountId) !== Boolean(normalizedEnvironmentName)){
    throw new Error(
      'Cloudflare account ID and Vectorize environment name must be provided together.'
    );
  }
  if(
    normalizedEnvironmentName &&
    (
      Buffer.byteLength(normalizedEnvironmentName, 'utf8') > 64 ||
      !/^[A-Za-z0-9_-]+$/.test(normalizedEnvironmentName)
    )
  ){
    throw new Error('Vectorize environment name is invalid.');
  }

  return {
    bound: Boolean(normalizedAccountId),
    accountFingerprint: normalizedAccountId
      ? sha256(`cloudflare-account:${normalizedAccountId}`)
      : '',
    environmentName: normalizedEnvironmentName
  };
}

function buildEnvironmentIdentity({
  environmentTarget,
  indexName,
  embeddingModel,
  dimensions,
  knowledgeFingerprint,
  idStrategy
}){
  const target = isPlainObject(environmentTarget)
    ? environmentTarget
    : createEnvironmentTarget();
  return validateEnvironmentIdentity({
    schemaVersion: ENVIRONMENT_IDENTITY_SCHEMA_VERSION,
    bound: target.bound === true,
    accountFingerprint: String(target.accountFingerprint || ''),
    environmentName: String(target.environmentName || ''),
    indexName,
    embeddingModel,
    dimensions,
    knowledgeFingerprint,
    idStrategy
  });
}

function validateEnvironmentIdentity(identity, label = 'Environment identity'){
  if(!isPlainObject(identity)){
    throw new Error(`${label} must be a JSON object.`);
  }
  if(identity.schemaVersion !== ENVIRONMENT_IDENTITY_SCHEMA_VERSION){
    throw new Error(`${label} has an unsupported schemaVersion.`);
  }

  const bound = identity.bound === true;
  const accountFingerprint = String(identity.accountFingerprint || '').trim();
  const environmentName = String(identity.environmentName || '').trim();
  if(bound){
    if(!/^[a-f0-9]{64}$/.test(accountFingerprint)){
      throw new Error(`${label} accountFingerprint is invalid.`);
    }
    if(
      !environmentName ||
      Buffer.byteLength(environmentName, 'utf8') > 64 ||
      !/^[A-Za-z0-9_-]+$/.test(environmentName)
    ){
      throw new Error(`${label} environmentName is invalid.`);
    }
  }else if(accountFingerprint || environmentName){
    throw new Error(`${label} cannot contain a partial environment binding.`);
  }

  const indexName = assertNonEmptyString(identity.indexName, `${label} indexName`);
  const embeddingModel = assertNonEmptyString(
    identity.embeddingModel,
    `${label} embeddingModel`
  );
  const knowledgeFingerprint = assertNonEmptyString(
    identity.knowledgeFingerprint,
    `${label} knowledgeFingerprint`
  );
  const idStrategy = assertNonEmptyString(identity.idStrategy, `${label} idStrategy`);
  const dimensions = Number(identity.dimensions);
  if(!Number.isInteger(dimensions) || dimensions < 1){
    throw new Error(`${label} dimensions must be a positive integer.`);
  }

  return {
    schemaVersion: ENVIRONMENT_IDENTITY_SCHEMA_VERSION,
    bound,
    accountFingerprint,
    environmentName,
    indexName,
    embeddingModel,
    dimensions,
    knowledgeFingerprint,
    idStrategy
  };
}

function assertEnvironmentIdentityMatches(
  actualIdentity,
  expectedIdentity,
  label = 'Lifecycle artifact'
){
  const actual = validateEnvironmentIdentity(actualIdentity, `${label} environment identity`);
  const expected = validateEnvironmentIdentity(
    expectedIdentity,
    'Expected environment identity'
  );
  if(JSON.stringify(actual) !== JSON.stringify(expected)){
    throw new Error(`${label} targets a different Vectorize environment.`);
  }
  return actual;
}

function requireBoundEnvironmentIdentity(identity, label = 'Environment identity'){
  const validated = validateEnvironmentIdentity(identity, label);
  if(!validated.bound){
    throw new Error(
      `${label} is not bound. Set CLOUDFLARE_ACCOUNT_ID and VECTORIZE_ENVIRONMENT.`
    );
  }
  return validated;
}

function assertVectorId(id, label = 'Vector ID'){
  const normalized = assertNonEmptyString(id, label);
  if(Buffer.byteLength(normalized, 'utf8') > MAX_VECTOR_ID_BYTES){
    throw new Error(`${label} exceeds ${MAX_VECTOR_ID_BYTES} bytes.`);
  }
  if(!/^[A-Za-z0-9_-]+$/.test(normalized)){
    throw new Error(`${label} contains unsupported characters.`);
  }
  return normalized;
}

function expandManifestIds(manifest){
  const explicitIds = Array.isArray(manifest.ids) ? manifest.ids : null;
  const idRanges = Array.isArray(manifest.idRanges) ? manifest.idRanges : null;

  if(Boolean(explicitIds) === Boolean(idRanges)){
    throw new Error('Manifest must define exactly one of ids or idRanges.');
  }

  if(explicitIds){
    if(explicitIds.length > MAX_MANIFEST_IDS){
      throw new Error(`Manifest contains more than ${MAX_MANIFEST_IDS} IDs.`);
    }
    return explicitIds.map((id, index) => assertVectorId(id, `Manifest ID ${index + 1}`));
  }

  const ids = [];
  for(const [rangeIndex, range] of idRanges.entries()){
    if(!isPlainObject(range)){
      throw new Error(`Manifest ID range ${rangeIndex + 1} is invalid.`);
    }

    const prefix = String(range.prefix || '');
    const start = Number(range.start);
    const end = Number(range.end);
    const width = Number(range.width);
    if(
      !/^[A-Za-z0-9_-]+$/.test(prefix) ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      !Number.isInteger(width) ||
      start < 0 ||
      end < start ||
      width < 1 ||
      width > 12
    ){
      throw new Error(`Manifest ID range ${rangeIndex + 1} is invalid.`);
    }

    const rangeCount = end - start + 1;
    if(ids.length + rangeCount > MAX_MANIFEST_IDS){
      throw new Error(`Manifest expands to more than ${MAX_MANIFEST_IDS} IDs.`);
    }

    for(let value = start; value <= end; value += 1){
      ids.push(assertVectorId(
        `${prefix}${String(value).padStart(width, '0')}`,
        `Manifest range ID ${value}`
      ));
    }
  }

  return ids;
}

function manifestFingerprint(manifest, ids = expandManifestIds(manifest)){
  return sha256(JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    indexName: manifest.indexName,
    embeddingModel: manifest.embeddingModel,
    dimensions: manifest.dimensions,
    idStrategy: manifest.idStrategy,
    vectorCount: manifest.vectorCount,
    sourceCount: manifest.sourceCount,
    knowledgeFingerprint: manifest.knowledgeFingerprint,
    environmentIdentity: manifest.environmentIdentity || null,
    ids: [...ids].sort()
  }));
}

function validateManifest(manifest, label = 'Vectorize manifest'){
  if(!isPlainObject(manifest)){
    throw new Error(`${label} must be a JSON object.`);
  }
  if(manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION){
    throw new Error(`${label} has an unsupported schemaVersion.`);
  }

  const state = assertNonEmptyString(manifest.state, `${label} state`);
  if(state !== 'active' && state !== 'candidate'){
    throw new Error(`${label} state must be active or candidate.`);
  }

  const indexName = assertNonEmptyString(manifest.indexName, `${label} indexName`);
  const embeddingModel = assertNonEmptyString(
    manifest.embeddingModel,
    `${label} embeddingModel`
  );
  const idStrategy = assertNonEmptyString(manifest.idStrategy, `${label} idStrategy`);
  const knowledgeFingerprint = assertNonEmptyString(
    manifest.knowledgeFingerprint,
    `${label} knowledgeFingerprint`
  );
  const dimensions = Number(manifest.dimensions);
  const vectorCount = Number(manifest.vectorCount);
  const sourceCount = Number(manifest.sourceCount);

  if(!Number.isInteger(dimensions) || dimensions < 1){
    throw new Error(`${label} dimensions must be a positive integer.`);
  }
  if(!Number.isInteger(vectorCount) || vectorCount < 1){
    throw new Error(`${label} vectorCount must be a positive integer.`);
  }
  if(!Number.isInteger(sourceCount) || sourceCount < 1){
    throw new Error(`${label} sourceCount must be a positive integer.`);
  }

  const ids = expandManifestIds(manifest);
  const uniqueIds = new Set(ids);
  if(uniqueIds.size !== ids.length){
    throw new Error(`${label} contains duplicate IDs.`);
  }
  if(ids.length !== vectorCount){
    throw new Error(`${label} vectorCount does not match its IDs.`);
  }

  let environmentIdentity = null;
  if(manifest.environmentIdentity){
    environmentIdentity = validateEnvironmentIdentity(
      manifest.environmentIdentity,
      `${label} environment identity`
    );
    const expectedIdentity = buildEnvironmentIdentity({
      environmentTarget: {
        bound: environmentIdentity.bound,
        accountFingerprint: environmentIdentity.accountFingerprint,
        environmentName: environmentIdentity.environmentName
      },
      indexName,
      embeddingModel,
      dimensions,
      knowledgeFingerprint,
      idStrategy
    });
    assertEnvironmentIdentityMatches(
      environmentIdentity,
      expectedIdentity,
      label
    );
  }else if(state === 'candidate'){
    throw new Error(`${label} environmentIdentity is required.`);
  }

  const createdAt = manifest.createdAt
    ? assertTimestamp(manifest.createdAt, `${label} createdAt`)
    : '';
  if(state === 'candidate' && !createdAt){
    throw new Error(`${label} createdAt is required.`);
  }

  const expectedFingerprint = manifestFingerprint(manifest, ids);
  if(
    manifest.manifestFingerprint &&
    manifest.manifestFingerprint !== expectedFingerprint
  ){
    throw new Error(`${label} manifestFingerprint is invalid.`);
  }

  const { idRanges: _idRanges, ...manifestWithoutRanges } = manifest;
  return {
    ...manifestWithoutRanges,
    state,
    indexName,
    embeddingModel,
    dimensions,
    idStrategy,
    vectorCount,
    sourceCount,
    knowledgeFingerprint,
    environmentIdentity,
    ...(createdAt ? { createdAt } : {}),
    ids,
    manifestFingerprint: expectedFingerprint
  };
}

function parseManifestText(text, label = 'Vectorize manifest'){
  let parsed;
  try{
    parsed = JSON.parse(text);
  }catch{
    throw new Error(`${label} is not valid JSON.`);
  }
  return validateManifest(parsed, label);
}

function assignContentIds(chunks){
  if(!Array.isArray(chunks) || !chunks.length){
    throw new Error('Cannot assign vector IDs without chunks.');
  }

  const ids = new Set();
  return chunks.map((chunk, index) => {
    if(!isPlainObject(chunk) || !isPlainObject(chunk.metadata)){
      throw new Error(`Chunk ${index + 1} is invalid.`);
    }

    const source = assertNonEmptyString(chunk.metadata.source, `Chunk ${index + 1} source`);
    const section = assertNonEmptyString(chunk.metadata.section, `Chunk ${index + 1} section`);
    const text = assertNonEmptyString(chunk.text, `Chunk ${index + 1} text`);
    const contentHash = sha256(text);
    const identityHash = sha256(JSON.stringify([source, section, contentHash]));
    const id = assertVectorId(`k_${identityHash.slice(0, 48)}`);

    if(ids.has(id)){
      throw new Error(`Duplicate content-addressed vector ID detected: ${id}`);
    }
    ids.add(id);

    return {
      ...chunk,
      id,
      text,
      metadata: {
        ...chunk.metadata,
        source,
        section,
        content_hash: contentHash,
        vector_id_strategy: ID_STRATEGY
      }
    };
  });
}

function buildCandidateManifest({
  chunks,
  indexName,
  embeddingModel,
  dimensions,
  environmentTarget = createEnvironmentTarget(),
  createdAt = new Date().toISOString()
}){
  if(!Array.isArray(chunks) || !chunks.length){
    throw new Error('Cannot build a candidate manifest without chunks.');
  }

  const ids = chunks.map((chunk) => assertVectorId(chunk.id)).sort();
  if(new Set(ids).size !== ids.length){
    throw new Error('Candidate chunks contain duplicate vector IDs.');
  }

  const sources = new Map();
  for(const chunk of chunks){
    const source = assertNonEmptyString(chunk.metadata?.source, 'Candidate source');
    const sourceChunks = sources.get(source) || [];
    sourceChunks.push({
      id: chunk.id,
      contentHash: assertNonEmptyString(
        chunk.metadata?.content_hash,
        `Content hash for ${chunk.id}`
      )
    });
    sources.set(source, sourceChunks);
  }

  const sourceSummaries = [...sources.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, sourceChunks]) => ({
      source,
      chunkCount: sourceChunks.length,
      contentFingerprint: sha256(JSON.stringify(
        sourceChunks
          .map((item) => `${item.id}:${item.contentHash}`)
          .sort()
      ))
    }));

  const knowledgeFingerprint = sha256(JSON.stringify({
    embeddingModel,
    dimensions,
    ids
  }));
  const environmentIdentity = buildEnvironmentIdentity({
    environmentTarget,
    indexName,
    embeddingModel,
    dimensions,
    knowledgeFingerprint,
    idStrategy: ID_STRATEGY
  });
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    state: 'candidate',
    indexName,
    embeddingModel,
    dimensions,
    idStrategy: ID_STRATEGY,
    vectorCount: ids.length,
    sourceCount: sourceSummaries.length,
    knowledgeFingerprint,
    environmentIdentity,
    createdAt: assertTimestamp(createdAt, 'Candidate manifest createdAt'),
    ids,
    sources: sourceSummaries
  };

  return {
    ...manifest,
    manifestFingerprint: manifestFingerprint(manifest, ids)
  };
}

function diffManifests(activeManifest, candidateManifest){
  const active = validateManifest(activeManifest, 'Active Vectorize manifest');
  const candidate = validateManifest(candidateManifest, 'Candidate Vectorize manifest');

  if(
    active.indexName !== candidate.indexName ||
    active.embeddingModel !== candidate.embeddingModel ||
    active.dimensions !== candidate.dimensions
  ){
    throw new Error('Active and candidate manifests target different Vectorize settings.');
  }
  if(candidate.idStrategy !== ID_STRATEGY){
    throw new Error('Candidate manifest does not use the required content ID strategy.');
  }

  const activeIds = new Set(active.ids);
  const candidateIds = new Set(candidate.ids);
  const staleIds = active.ids.filter((id) => !candidateIds.has(id)).sort();
  const newIds = candidate.ids.filter((id) => !activeIds.has(id)).sort();
  const retainedIds = candidate.ids.filter((id) => activeIds.has(id)).sort();

  if(staleIds.some((id) => candidateIds.has(id))){
    throw new Error('Stale vector plan includes a current ID.');
  }

  return { active, candidate, staleIds, newIds, retainedIds };
}

function buildStalePlan(activeManifest, candidateManifest){
  const diff = diffManifests(activeManifest, candidateManifest);
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    indexName: diff.active.indexName,
    baseManifestFingerprint: diff.active.manifestFingerprint,
    candidateManifestFingerprint: diff.candidate.manifestFingerprint,
    candidateKnowledgeFingerprint: diff.candidate.knowledgeFingerprint,
    environmentIdentity: diff.candidate.environmentIdentity,
    createdAt: new Date().toISOString(),
    staleCount: diff.staleIds.length,
    ids: diff.staleIds
  };
}

function validateStalePlan(plan, activeManifest, candidateManifest){
  if(!isPlainObject(plan) || plan.schemaVersion !== MANIFEST_SCHEMA_VERSION){
    throw new Error('Stale vector plan is invalid.');
  }

  const expected = buildStalePlan(activeManifest, candidateManifest);
  assertTimestamp(plan.createdAt, 'Stale vector plan createdAt');
  assertEnvironmentIdentityMatches(
    plan.environmentIdentity,
    expected.environmentIdentity,
    'Stale vector plan'
  );
  if(
    plan.indexName !== expected.indexName ||
    plan.baseManifestFingerprint !== expected.baseManifestFingerprint ||
    plan.candidateManifestFingerprint !== expected.candidateManifestFingerprint ||
    plan.candidateKnowledgeFingerprint !== expected.candidateKnowledgeFingerprint ||
    plan.staleCount !== expected.staleCount ||
    JSON.stringify(plan.ids) !== JSON.stringify(expected.ids)
  ){
    throw new Error('Stale vector plan does not match the active and candidate manifests.');
  }

  return {
    ...expected,
    createdAt: plan.createdAt
  };
}

function getDeletionSummary(activeManifest, candidateManifest, stalePlan){
  const active = validateManifest(activeManifest, 'Active Vectorize manifest');
  const candidate = validateManifest(candidateManifest, 'Candidate Vectorize manifest');
  const plan = validateStalePlan(stalePlan, active, candidate);
  const deletionRatio = plan.staleCount / active.vectorCount;
  return {
    activeCount: active.vectorCount,
    candidateCount: candidate.vectorCount,
    staleCount: plan.staleCount,
    deletionRatio,
    requiresFullReplacementConfirmation:
      plan.staleCount === active.vectorCount ||
      deletionRatio > HIGH_RISK_DELETION_RATIO
  };
}

function validateDeletionConfirmation({
  activeManifest,
  candidateManifest,
  stalePlan,
  confirmation,
  confirmFullReplacement = false
}){
  const summary = getDeletionSummary(activeManifest, candidateManifest, stalePlan);
  const candidate = validateManifest(candidateManifest, 'Candidate Vectorize manifest');
  if(!confirmation || confirmation !== candidate.manifestFingerprint){
    throw new Error('Candidate manifest fingerprint confirmation is invalid.');
  }
  if(summary.requiresFullReplacementConfirmation && !confirmFullReplacement){
    throw new Error('High-risk stale deletion requires --confirm-full-replacement.');
  }
  if(!summary.requiresFullReplacementConfirmation && confirmFullReplacement){
    throw new Error(
      '--confirm-full-replacement is only valid for a high-risk stale deletion.'
    );
  }
  return summary;
}

function reconcileRemoteIds({
  remoteIds,
  activeManifest,
  candidateManifest,
  stalePlan
}){
  if(!Array.isArray(remoteIds)){
    throw new Error('Remote Vectorize snapshot must contain an IDs array.');
  }
  if(remoteIds.length > MAX_MANIFEST_IDS){
    throw new Error(`Remote Vectorize snapshot contains more than ${MAX_MANIFEST_IDS} IDs.`);
  }

  const active = validateManifest(activeManifest, 'Active Vectorize manifest');
  const candidate = validateManifest(candidateManifest, 'Candidate Vectorize manifest');
  const validatedPlan = validateStalePlan(stalePlan, active, candidate);
  const normalizedRemoteIds = remoteIds
    .map((id, index) => assertVectorId(id, `Remote Vectorize ID ${index + 1}`))
    .sort();

  if(new Set(normalizedRemoteIds).size !== normalizedRemoteIds.length){
    throw new Error('Remote Vectorize snapshot contains duplicate IDs.');
  }

  const remoteSet = new Set(normalizedRemoteIds);
  const activeSet = new Set(active.ids);
  const candidateSet = new Set(candidate.ids);
  const expectedRemoteSet = new Set([...active.ids, ...candidate.ids]);
  const missingCandidateIds = candidate.ids.filter((id) => !remoteSet.has(id));
  if(missingCandidateIds.length){
    throw new Error(
      `Remote Vectorize snapshot is missing ${missingCandidateIds.length} candidate IDs.`
    );
  }

  const unexpectedIds = normalizedRemoteIds
    .filter((id) => !expectedRemoteSet.has(id));
  if(unexpectedIds.length){
    throw new Error(
      `Remote Vectorize snapshot contains ${unexpectedIds.length} unmanaged IDs.`
    );
  }

  const deletableStaleIds = validatedPlan.ids
    .filter((id) => remoteSet.has(id))
    .sort();
  if(deletableStaleIds.some((id) => candidateSet.has(id))){
    throw new Error('Remote reconciliation selected a current candidate ID for deletion.');
  }
  if(deletableStaleIds.some((id) => !activeSet.has(id))){
    throw new Error('Remote reconciliation selected an ID outside the active manifest.');
  }

  return {
    remoteIds: normalizedRemoteIds,
    remoteCount: normalizedRemoteIds.length,
    missingCandidateIds: [],
    unexpectedIds: [],
    deletableStaleIds,
    alreadyAbsentStaleIds: validatedPlan.ids
      .filter((id) => !remoteSet.has(id))
      .sort()
  };
}

module.exports = {
  ENVIRONMENT_IDENTITY_SCHEMA_VERSION,
  HIGH_RISK_DELETION_RATIO,
  ID_STRATEGY,
  MANIFEST_SCHEMA_VERSION,
  assertEnvironmentIdentityMatches,
  assignContentIds,
  buildEnvironmentIdentity,
  buildCandidateManifest,
  buildStalePlan,
  createEnvironmentTarget,
  diffManifests,
  getDeletionSummary,
  manifestFingerprint,
  parseManifestText,
  reconcileRemoteIds,
  requireBoundEnvironmentIdentity,
  sha256,
  validateDeletionConfirmation,
  validateEnvironmentIdentity,
  validateManifest,
  validateStalePlan
};
