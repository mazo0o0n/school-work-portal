import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  assertEnvironmentIdentityMatches,
  assignContentIds,
  buildCandidateManifest,
  buildStalePlan,
  createEnvironmentTarget,
  diffManifests,
  parseManifestText,
  reconcileRemoteIds,
  validateDeletionConfirmation,
  validateStalePlan
} = require('../tools/vectorize-lifecycle.js');
const {
  getKnowledgeSources,
  main,
  prepareKnowledgeState,
  readVectorFileSummary,
  validateRemoteSnapshotData,
  validateUploadReceiptData
} = require('../tools/ingest-knowledge.js');

const INDEX_NAME = 'school_knowledge_index';
const EMBEDDING_MODEL = '@cf/qwen/qwen3-embedding-0.6b';
const DIMENSIONS = 1024;
const TEST_ENVIRONMENT_TARGET = createEnvironmentTarget({
  accountId: 'local-test-account-a',
  environmentName: 'production'
});

function createChunk(text, source = 'knowledge.md', section = 'قسم تجريبي'){
  return {
    text,
    metadata: { source, section }
  };
}

function createCandidate(chunks, environmentTarget = TEST_ENVIRONMENT_TARGET){
  const identified = assignContentIds(chunks);
  return buildCandidateManifest({
    chunks: identified,
    indexName: INDEX_NAME,
    embeddingModel: EMBEDDING_MODEL,
    dimensions: DIMENSIONS,
    environmentTarget,
    createdAt: '2026-07-19T00:00:00.000Z'
  });
}

function createActive(ids){
  return {
    schemaVersion: 1,
    state: 'active',
    indexName: INDEX_NAME,
    embeddingModel: EMBEDDING_MODEL,
    dimensions: DIMENSIONS,
    idStrategy: 'test-active-v1',
    vectorCount: ids.length,
    sourceCount: 1,
    knowledgeFingerprint: 'test-active-fingerprint',
    ids
  };
}

function createVectorFixture(texts = ['local vector text']){
  const identified = assignContentIds(texts.map((text) => createChunk(text)));
  const candidate = buildCandidateManifest({
    chunks: identified,
    indexName: INDEX_NAME,
    embeddingModel: EMBEDDING_MODEL,
    dimensions: DIMENSIONS,
    environmentTarget: TEST_ENVIRONMENT_TARGET,
    createdAt: '2026-07-19T00:00:00.000Z'
  });
  const vectors = identified.map((chunk) => ({
    id: chunk.id,
    values: Array(DIMENSIONS).fill(0),
    metadata: {
      ...chunk.metadata,
      text: chunk.text,
      knowledge_version: candidate.knowledgeFingerprint,
      embedding_model: EMBEDDING_MODEL
    }
  }));
  return { candidate, identified, vectors };
}

function withTempNdjson(content, callback){
  const directory = mkdtempSync(join(tmpdir(), 'vectorize-lifecycle-'));
  const filePath = join(directory, 'vectors.ndjson');
  try{
    const text = Array.isArray(content)
      ? `${content.map((vector) => JSON.stringify(vector)).join('\n')}\n`
      : content;
    writeFileSync(filePath, text, 'utf8');
    return callback(filePath);
  }finally{
    rmSync(directory, { recursive: true, force: true });
  }
}

function createReceipt(candidate, environmentIdentity = candidate.environmentIdentity){
  return {
    schemaVersion: 1,
    indexName: candidate.indexName,
    candidateManifestFingerprint: candidate.manifestFingerprint,
    candidateKnowledgeFingerprint: candidate.knowledgeFingerprint,
    environmentIdentity,
    createdAt: '2026-07-19T00:01:00.000Z',
    uploadedVectorCount: candidate.vectorCount
  };
}

function createSnapshot(
  active,
  candidate,
  environmentIdentity = candidate.environmentIdentity
){
  const ids = [...active.ids, ...candidate.ids];
  return {
    schemaVersion: 1,
    indexName: candidate.indexName,
    baseManifestFingerprint: buildStalePlan(active, candidate).baseManifestFingerprint,
    candidateManifestFingerprint: candidate.manifestFingerprint,
    candidateKnowledgeFingerprint: candidate.knowledgeFingerprint,
    environmentIdentity,
    createdAt: '2026-07-19T00:02:00.000Z',
    remoteCount: ids.length,
    ids
  };
}

test('keeps content-addressed IDs stable when chunk order changes', () => {
  const firstOrder = assignContentIds([
    createChunk('المحتوى الأول'),
    createChunk('المحتوى الثاني')
  ]);
  const reversedOrder = assignContentIds([
    createChunk('المحتوى الثاني'),
    createChunk('المحتوى الأول')
  ]);
  const firstIdsByText = new Map(firstOrder.map((chunk) => [chunk.text, chunk.id]));
  const reversedIdsByText = new Map(reversedOrder.map((chunk) => [chunk.text, chunk.id]));

  assert.deepEqual(reversedIdsByText, firstIdsByText);
  assert.ok(firstOrder.every((chunk) => Buffer.byteLength(chunk.id, 'utf8') <= 64));
});

test('changes a vector ID when its content changes', () => {
  const original = assignContentIds([createChunk('محتوى ثابت')])[0];
  const changed = assignContentIds([createChunk('محتوى ثابت بعد التعديل')])[0];

  assert.notEqual(changed.id, original.id);
  assert.notEqual(changed.metadata.content_hash, original.metadata.content_hash);
});

test('detects only stale IDs and never includes a current ID', () => {
  const candidate = createCandidate([
    createChunk('المحتوى الحالي الأول'),
    createChunk('المحتوى الحالي الثاني')
  ]);
  const retainedId = candidate.ids[0];
  const active = createActive([retainedId, 'k_legacy_stale']);
  const diff = diffManifests(active, candidate);
  const stalePlan = buildStalePlan(active, candidate);

  assert.deepEqual(diff.staleIds, ['k_legacy_stale']);
  assert.ok(diff.retainedIds.includes(retainedId));
  assert.ok(stalePlan.ids.every((id) => !candidate.ids.includes(id)));
  assert.deepEqual(validateStalePlan(stalePlan, active, candidate), stalePlan);
});

test('reconciles remote IDs without selecting a current ID for deletion', () => {
  const candidate = createCandidate([
    createChunk('المحتوى الحالي الأول'),
    createChunk('المحتوى الحالي الثاني')
  ]);
  const retainedId = candidate.ids[0];
  const active = createActive([retainedId, 'k_legacy_present', 'k_legacy_absent']);
  const stalePlan = buildStalePlan(active, candidate);
  const reconciliation = reconcileRemoteIds({
    remoteIds: [...candidate.ids, 'k_legacy_present'],
    activeManifest: active,
    candidateManifest: candidate,
    stalePlan
  });

  assert.deepEqual(reconciliation.deletableStaleIds, ['k_legacy_present']);
  assert.deepEqual(reconciliation.alreadyAbsentStaleIds, ['k_legacy_absent']);
  assert.ok(reconciliation.deletableStaleIds.every(
    (id) => !candidate.ids.includes(id)
  ));
});

test('fails safely when the remote snapshot has missing or unmanaged IDs', () => {
  const candidate = createCandidate([createChunk('المحتوى الحالي')]);
  const active = createActive(['k_legacy_stale']);
  const stalePlan = buildStalePlan(active, candidate);

  assert.throws(
    () => reconcileRemoteIds({
      remoteIds: ['k_legacy_stale'],
      activeManifest: active,
      candidateManifest: candidate,
      stalePlan
    }),
    /missing 1 candidate IDs/
  );
  assert.throws(
    () => reconcileRemoteIds({
      remoteIds: [...candidate.ids, 'k_legacy_stale', 'k_unmanaged'],
      activeManifest: active,
      candidateManifest: candidate,
      stalePlan
    }),
    /1 unmanaged IDs/
  );
});

test('fails safely for corrupt or incomplete manifests', () => {
  assert.throws(
    () => parseManifestText('{', 'Corrupt manifest'),
    /not valid JSON/
  );
  assert.throws(
    () => parseManifestText('{}', 'Incomplete manifest'),
    /schemaVersion/
  );
  assert.throws(
    () => parseManifestText(JSON.stringify({
      ...createActive(['k_one']),
      vectorCount: 2
    }), 'Mismatched manifest'),
    /vectorCount/
  );
});

test('preview performs no embedding, upload, or delete operation', async () => {
  let embeddingCalled = false;
  let wranglerCalled = false;
  const result = await main(
    ['--preview'],
    {
      async embeddingGenerator(){
        embeddingCalled = true;
        throw new Error('Preview must not request embeddings.');
      },
      spawn(){
        wranglerCalled = true;
        throw new Error('Preview must not invoke Wrangler.');
      },
      log(){}
    }
  );

  assert.equal(result.cloudMutation, false);
  assert.equal(embeddingCalled, false);
  assert.equal(wranglerCalled, false);
  assert.equal(result.sourceCount, 23);
  assert.equal(result.vectorCount, 641);
});

test('keeps the current knowledge source and chunk counts', () => {
  const sources = getKnowledgeSources();
  const state = prepareKnowledgeState();

  assert.equal(sources.length, 23);
  assert.equal(state.sources.length, 23);
  assert.equal(state.chunks.length, 641);
  assert.equal(state.candidateManifest.vectorCount, 641);
  assert.equal(state.candidateManifest.sourceCount, 23);
});

test('requires an explicit account and environment for sensitive lifecycle modes', async () => {
  const target = createEnvironmentTarget({
    accountId: 'local-test-account-a',
    environmentName: 'production'
  });

  assert.equal(target.bound, true);
  assert.match(target.accountFingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(target), /local-test-account-a/);
  assert.throws(
    () => createEnvironmentTarget({ accountId: 'local-test-account-a' }),
    /provided together/
  );

  await assert.rejects(
    () => main(
      ['--export-vectors'],
      {
        runtimeEnv: {},
        async embeddingGenerator(){
          throw new Error('must not run');
        },
        spawn(){
          throw new Error('must not run');
        },
        log(){}
      }
    ),
    /not bound/
  );
});

test('rejects environment identity mismatches across lifecycle artifacts', async (t) => {
  const candidate = createCandidate([createChunk('environment identity')]);
  const expected = candidate.environmentIdentity;
  const mismatches = [
    ['account identity', {
      ...expected,
      accountFingerprint: 'b'.repeat(64)
    }],
    ['environment name', {
      ...expected,
      environmentName: 'staging'
    }],
    ['index name', {
      ...expected,
      indexName: 'different_index'
    }],
    ['embedding model', {
      ...expected,
      embeddingModel: '@cf/test/different-model'
    }],
    ['dimensions', {
      ...expected,
      dimensions: 768
    }]
  ];

  for(const [name, identity] of mismatches){
    await t.test(name, () => {
      assert.throws(
        () => assertEnvironmentIdentityMatches(identity, expected, name),
        /different Vectorize environment/
      );
    });
  }

  const otherEnvironment = {
    ...expected,
    environmentName: 'staging'
  };
  const active = createActive(['k_legacy_environment']);
  const stalePlan = buildStalePlan(active, candidate);

  await t.test('receipt from another environment', () => {
    assert.throws(
      () => validateUploadReceiptData(
        createReceipt(candidate, otherEnvironment),
        candidate
      ),
      /different Vectorize environment/
    );
  });
  await t.test('remote snapshot from another environment', () => {
    assert.throws(
      () => validateRemoteSnapshotData(
        createSnapshot(active, candidate, otherEnvironment),
        active,
        candidate,
        stalePlan
      ),
      /different Vectorize environment/
    );
  });
});

test('requires two explicit confirmations for a high-risk full replacement', () => {
  const candidate = createCandidate([
    createChunk('replacement one'),
    createChunk('replacement two')
  ]);
  const active = createActive(['k_legacy_one', 'k_legacy_two']);
  const stalePlan = buildStalePlan(active, candidate);

  assert.throws(
    () => validateDeletionConfirmation({
      activeManifest: active,
      candidateManifest: candidate,
      stalePlan,
      confirmation: candidate.manifestFingerprint
    }),
    /confirm-full-replacement/
  );
  assert.throws(
    () => validateDeletionConfirmation({
      activeManifest: active,
      candidateManifest: candidate,
      stalePlan,
      confirmation: 'wrong-fingerprint',
      confirmFullReplacement: true
    }),
    /fingerprint confirmation is invalid/
  );

  const summary = validateDeletionConfirmation({
    activeManifest: active,
    candidateManifest: candidate,
    stalePlan,
    confirmation: candidate.manifestFingerprint,
    confirmFullReplacement: true
  });
  assert.equal(summary.activeCount, 2);
  assert.equal(summary.candidateCount, 2);
  assert.equal(summary.staleCount, 2);
  assert.equal(summary.deletionRatio, 1);
  assert.equal(summary.requiresFullReplacementConfirmation, true);

  const retainedCandidate = createCandidate([
    createChunk('retained one'),
    createChunk('retained two')
  ]);
  const partialActive = createActive([
    ...retainedCandidate.ids,
    'k_single_stale'
  ]);
  const partialPlan = buildStalePlan(partialActive, retainedCandidate);
  assert.throws(
    () => validateDeletionConfirmation({
      activeManifest: partialActive,
      candidateManifest: retainedCandidate,
      stalePlan: partialPlan,
      confirmation: retainedCandidate.manifestFingerprint,
      confirmFullReplacement: true
    }),
    /only valid for a high-risk/
  );
});

test('strictly validates Vectorize NDJSON before remote operations', async (t) => {
  const fixture = createVectorFixture(['strict vector one', 'strict vector two']);

  await t.test('valid candidate NDJSON', () => {
    withTempNdjson(fixture.vectors, (filePath) => {
      const summary = readVectorFileSummary(filePath, {
        validateValues: true,
        candidateManifest: fixture.candidate
      });
      assert.equal(summary.count, 2);
      assert.deepEqual(summary.ids, [...fixture.candidate.ids].sort());
    });
  });

  const invalidJsonCases = [
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity']
  ];
  for(const [name, invalidValue] of invalidJsonCases){
    await t.test(`rejects ${name}`, () => {
      const line = JSON.stringify(fixture.vectors[0])
        .replace('"values":[0', `"values":[${invalidValue}`);
      withTempNdjson(`${line}\n`, (filePath) => {
        assert.throws(
          () => readVectorFileSummary(filePath, true),
          /invalid JSON/
        );
      });
    });
  }

  await t.test('rejects wrong dimensions', () => {
    const vector = globalThis.structuredClone(fixture.vectors[0]);
    vector.values.pop();
    withTempNdjson([vector], (filePath) => {
      assert.throws(
        () => readVectorFileSummary(filePath, true),
        /does not have 1024 dimensions/
      );
    });
  });

  await t.test('rejects missing metadata', () => {
    const vector = globalThis.structuredClone(fixture.vectors[0]);
    delete vector.metadata.source;
    withTempNdjson([vector], (filePath) => {
      assert.throws(
        () => readVectorFileSummary(filePath, true),
        /metadata field source is invalid/
      );
    });
  });

  await t.test('rejects metadata larger than 10KiB', () => {
    const vector = globalThis.structuredClone(fixture.vectors[0]);
    vector.metadata.padding = 'x'.repeat(11 * 1024);
    withTempNdjson([vector], (filePath) => {
      assert.throws(
        () => readVectorFileSummary(filePath, true),
        /metadata exceeds 10240 bytes/
      );
    });
  });

  await t.test('rejects IDs longer than 64 UTF-8 bytes', () => {
    const vector = globalThis.structuredClone(fixture.vectors[0]);
    vector.id = `k_${'a'.repeat(64)}`;
    withTempNdjson([vector], (filePath) => {
      assert.throws(
        () => readVectorFileSummary(filePath, true),
        /Vector ID at line 1 is invalid/
      );
    });
  });

  await t.test('rejects duplicate IDs', () => {
    withTempNdjson(
      [fixture.vectors[0], fixture.vectors[0]],
      (filePath) => {
        assert.throws(
          () => readVectorFileSummary(filePath, true),
          /duplicate IDs/
        );
      }
    );
  });

  await t.test('rejects an ID missing from NDJSON', () => {
    withTempNdjson([fixture.vectors[0]], (filePath) => {
      assert.throws(
        () => readVectorFileSummary(filePath, {
          validateValues: true,
          candidateManifest: fixture.candidate
        }),
        /count does not match/
      );
    });
  });

  await t.test('rejects an extra ID outside the manifest', () => {
    const extraFixture = createVectorFixture(['strict vector extra']);
    const extra = globalThis.structuredClone(extraFixture.vectors[0]);
    extra.metadata.knowledge_version = fixture.candidate.knowledgeFingerprint;
    withTempNdjson([...fixture.vectors, extra], (filePath) => {
      assert.throws(
        () => readVectorFileSummary(filePath, {
          validateValues: true,
          candidateManifest: fixture.candidate
        }),
        /count does not match/
      );
    });
  });
});

test('rejects changed knowledge and unsafe stale artifacts', () => {
  const original = createCandidate([createChunk('knowledge before export')]);
  const changed = createCandidate([createChunk('knowledge after export')]);
  const active = createActive(['k_legacy_stale']);
  const originalPlan = buildStalePlan(active, original);

  assert.notEqual(original.knowledgeFingerprint, changed.knowledgeFingerprint);
  assert.throws(
    () => validateStalePlan(originalPlan, active, changed),
    /different Vectorize environment|does not match/
  );
  assert.throws(
    () => validateStalePlan({
      ...originalPlan,
      staleCount: 1,
      ids: ['*']
    }, active, original),
    /does not match/
  );
});

test('rejects missing upload receipts and remote snapshots', () => {
  const candidate = createCandidate([createChunk('missing artifact')]);
  const active = createActive(['k_legacy_missing_artifact']);
  const stalePlan = buildStalePlan(active, candidate);

  assert.throws(
    () => validateUploadReceiptData(null, candidate),
    /missing or invalid/
  );
  assert.throws(
    () => validateRemoteSnapshotData(null, active, candidate, stalePlan),
    /missing or invalid/
  );
});
