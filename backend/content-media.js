const crypto = require('node:crypto');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { processRemoteImage } = require('./image-pipeline');
const { publicAvatarUrl } = require('./avatar-storage');

const R2_DEADLINE_MS = 8000;
const ASSET_PREFIX = 'portfolio/assets/';
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

function isOwnedAssetKey(key) {
  return typeof key === 'string' && key.startsWith(ASSET_PREFIX) && key.length > ASSET_PREFIX.length;
}

function buildAssetKey(ext, randomBytes = crypto.randomBytes) {
  return `${ASSET_PREFIX}${randomBytes(18).toString('hex')}.${ext}`;
}

function isCurrentR2Url(sourceUrl, config) {
  if (!sourceUrl || !config?.publicBaseUrl) return false;
  try {
    return new URL(sourceUrl).origin === new URL(config.publicBaseUrl).origin;
  } catch {
    return false;
  }
}

async function withAbortDeadline(operation, timeoutMs = R2_DEADLINE_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultVerifyPublicUrl({ publicUrl, body, mime }, options = {}) {
  const fetchImpl = options.fetch || fetch;
  const response = await withAbortDeadline(signal => fetchImpl(publicUrl, {
    cache: 'no-store',
    signal,
  }), options.timeoutMs);
  if (!response.ok) throw new Error('R2_PUBLIC_VERIFY_FAILED');
  const responseType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (responseType !== mime) throw new Error('R2_PUBLIC_VERIFY_FAILED');
  const publicBody = Buffer.from(await response.arrayBuffer());
  if (publicBody.length !== body.length || !crypto.timingSafeEqual(crypto.createHash('sha256').update(publicBody).digest(), crypto.createHash('sha256').update(body).digest())) {
    throw new Error('R2_PUBLIC_VERIFY_FAILED');
  }
}

async function prepareAsset(sourceUrl, options = {}) {
  const value = String(sourceUrl || '').trim();
  if (!value) return { publicUrl: null, objectKey: null };
  const config = options.r2Config;
  if (isCurrentR2Url(value, config)) return { publicUrl: value, objectKey: null };
  if (!config?.bucket || !config?.publicBaseUrl || !options.r2Client) throw new Error('R2 configuration incomplete');

  const processImage = options.processRemoteImage || processRemoteImage;
  const normalized = await processImage(value, options.imageOptions || options);
  const objectKey = buildAssetKey(normalized.ext, options.randomBytes);
  await withAbortDeadline(signal => options.r2Client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: objectKey,
    Body: normalized.body,
    ContentType: normalized.mime,
    CacheControl: IMMUTABLE_CACHE,
  }), { abortSignal: signal }), options.uploadTimeoutMs);
  const publicUrl = publicAvatarUrl(config.publicBaseUrl, objectKey);
  const verify = options.verifyPublicUrl || (input => defaultVerifyPublicUrl(input, options));
  await verify({ publicUrl, body: normalized.body, mime: normalized.mime });
  return { publicUrl, objectKey };
}

async function deleteOwnedAsset(objectKey, options = {}) {
  if (!isOwnedAssetKey(objectKey)) throw new Error('INVALID_OWNED_ASSET_KEY');
  if (!options.r2Config?.bucket || !options.r2Client) throw new Error('R2 configuration incomplete');
  await withAbortDeadline(signal => options.r2Client.send(new DeleteObjectCommand({
    Bucket: options.r2Config.bucket,
    Key: objectKey,
  }), { abortSignal: signal }), options.uploadTimeoutMs);
}

async function referenceCount(objectKey, pool) {
  const [rows] = await pool.query({
    sql: `SELECT (
      (SELECT COUNT(*) FROM projects WHERE image_object_key = ?) +
      (SELECT COUNT(*) FROM experience WHERE logo_object_key = ?)
    ) AS references_count`,
    values: [objectKey, objectKey],
    timeout: 10000,
  });
  return Number(rows[0]?.references_count || 0);
}

async function queueCleanup(objectKey, pool, errorCode = 'R2_DELETE_FAILED') {
  if (!isOwnedAssetKey(objectKey)) throw new Error('INVALID_OWNED_ASSET_KEY');
  await pool.query(
    `INSERT INTO media_cleanup_queue (object_key, last_error_code)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE last_error_code=VALUES(last_error_code), updated_at=CURRENT_TIMESTAMP`,
    [objectKey, String(errorCode || 'R2_DELETE_FAILED').slice(0, 80)]
  );
}

async function cleanupOwnedAsset(objectKey, dependencies) {
  if (!objectKey) return false;
  if (!isOwnedAssetKey(objectKey)) throw new Error('INVALID_OWNED_ASSET_KEY');
  const countReferences = dependencies.referenceCount || (key => referenceCount(key, dependencies.pool));
  if (await countReferences(objectKey)) return false;
  const remove = dependencies.deleteOwnedAsset;
  try {
    await remove(objectKey);
    return true;
  } catch (error) {
    const enqueue = dependencies.queueCleanup || (key => queueCleanup(key, dependencies.pool, error.code || error.message));
    await enqueue(objectKey);
    return false;
  }
}

async function rollbackNewObject(asset, dependencies) {
  if (!asset?.objectKey || !isOwnedAssetKey(asset.objectKey)) return;
  try {
    await dependencies.deleteOwnedAsset(asset.objectKey);
  } catch (error) {
    if (!dependencies.queueCleanup && !dependencies.pool) throw error;
    const enqueue = dependencies.queueCleanup || (key => queueCleanup(key, dependencies.pool, error.code || error.message));
    await enqueue(asset.objectKey);
  }
}

async function saveMedia(kind, input, dependencies) {
  const definition = kind === 'project' ? {
    table: 'projects', keyColumn: 'image_object_key', sourceColumn: 'image_url', fallbackColumn: 'image_url_fallback',
    fields: ['title', 'title_id', 'description', 'description_id', 'url', 'full_width'],
  } : {
    table: 'experience', keyColumn: 'logo_object_key', sourceColumn: 'logo_url', fallbackColumn: 'logo_url_fallback',
    fields: ['company', 'role', 'role_id', 'date_range', 'description', 'description_id', 'url'],
  };
  const prepare = dependencies.prepareAsset;
  const asset = await prepare(input[definition.sourceColumn]);
  const connection = await dependencies.pool.getConnection();
  let oldKey = null;
  let committed = false;
  try {
    await connection.beginTransaction();
    if (input.id) {
      const [rows] = await connection.query(
        `SELECT ${definition.keyColumn} AS object_key FROM ${definition.table} WHERE id=? FOR UPDATE`,
        [input.id]
      );
      oldKey = rows[0]?.object_key || null;
      const assignments = [...definition.fields, definition.sourceColumn, definition.fallbackColumn, definition.keyColumn]
        .map(field => `${field}=?`).join(', ');
      const values = definition.fields.map(field => input[field] ?? null);
      values.push(input[definition.sourceColumn] || null, asset.publicUrl, asset.objectKey, input.id);
      await connection.query(`UPDATE ${definition.table} SET ${assignments} WHERE id=?`, values);
    } else {
      const columns = [...definition.fields, definition.sourceColumn, definition.fallbackColumn, definition.keyColumn];
      const values = definition.fields.map(field => input[field] ?? null);
      values.push(input[definition.sourceColumn] || null, asset.publicUrl, asset.objectKey);
      const [result] = await connection.query(
        `INSERT INTO ${definition.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        values
      );
      input.id = result.insertId;
    }
    await connection.commit();
    committed = true;
  } catch (error) {
    try { await connection.rollback(); } catch {}
    await rollbackNewObject(asset, dependencies);
    throw error;
  } finally {
    connection.release();
  }

  if (committed && oldKey && oldKey !== asset.objectKey) {
    await cleanupOwnedAsset(oldKey, dependencies);
  }
  return { id: input.id, publicUrl: asset.publicUrl, objectKey: asset.objectKey };
}

function saveProjectMedia(input, dependencies) {
  return saveMedia('project', { ...input }, dependencies);
}

function saveExperienceMedia(input, dependencies) {
  return saveMedia('experience', { ...input }, dependencies);
}

async function deleteMedia(kind, id, dependencies) {
  const definition = kind === 'project'
    ? { table: 'projects', keyColumn: 'image_object_key' }
    : { table: 'experience', keyColumn: 'logo_object_key' };
  const connection = await dependencies.pool.getConnection();
  let objectKey = null;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT ${definition.keyColumn} AS object_key FROM ${definition.table} WHERE id=? FOR UPDATE`,
      [id]
    );
    objectKey = rows[0]?.object_key || null;
    await connection.query(`DELETE FROM ${definition.table} WHERE id=?`, [id]);
    await connection.commit();
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
  if (objectKey) await cleanupOwnedAsset(objectKey, dependencies);
}

function deleteProjectWithMedia(id, dependencies) {
  return deleteMedia('project', id, dependencies);
}

function deleteExperienceWithMedia(id, dependencies) {
  return deleteMedia('experience', id, dependencies);
}

module.exports = {
  R2_DEADLINE_MS,
  ASSET_PREFIX,
  isOwnedAssetKey,
  buildAssetKey,
  prepareAsset,
  deleteOwnedAsset,
  referenceCount,
  queueCleanup,
  cleanupOwnedAsset,
  saveProjectMedia,
  saveExperienceMedia,
  deleteProjectWithMedia,
  deleteExperienceWithMedia,
};
