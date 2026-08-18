const https = require('node:https');
const dns = require('node:dns/promises');
const net = require('node:net');

const IMAGE_DEADLINE_MS = 8_000;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_MAX_PIXELS = 16_000_000;
const IMAGE_MAX_DIMENSION = 2048;
const MAX_REDIRECTS = 3;

function pipelineError(code, cause) {
  const error = new Error(code, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function createDeadline(timeoutMs = IMAGE_DEADLINE_MS) {
  const controller = new AbortController();
  const expiresAt = Date.now() + timeoutMs;
  const timeoutError = pipelineError('IMAGE_PROCESSING_TIMEOUT');
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  timer.unref?.();

  function expire() {
    if (!controller.signal.aborted) controller.abort(timeoutError);
    return controller.signal.reason || timeoutError;
  }

  return {
    signal: controller.signal,
    get aborted() { return controller.signal.aborted; },
    throwIfExpired() {
      if (controller.signal.aborted || Date.now() >= expiresAt) throw expire();
    },
    async run(work, onTimeout) {
      this.throwIfExpired();
      let abort;
      const aborted = new Promise((_, reject) => {
        abort = () => {
          onTimeout?.();
          reject(controller.signal.reason || timeoutError);
        };
        controller.signal.addEventListener('abort', abort, { once: true });
      });
      try {
        return await Promise.race([Promise.resolve().then(work), aborted]);
      } finally {
        controller.signal.removeEventListener('abort', abort);
      }
    },
    finish() {
      clearTimeout(timer);
    },
  };
}

function ipv4Number(address) {
  return address.split('.').reduce((value, octet) => (value * 256) + Number(octet), 0) >>> 0;
}

function ipv4InCidr(address, base, prefix) {
  const shift = 32 - prefix;
  return (ipv4Number(address) >>> shift) === (ipv4Number(base) >>> shift);
}

function expandIpv6(address) {
  if (address.includes('%')) return null;
  let value = address.toLowerCase();
  const ipv4Match = value.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    if (net.isIP(ipv4Match[1]) !== 4) return null;
    const ipv4 = ipv4Number(ipv4Match[1]);
    value = value.slice(0, -ipv4Match[1].length) + `${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const parts = halves.length === 2 ? [...left, ...Array(missing).fill('0'), ...right] : left;
  if (parts.length !== 8 || parts.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.reduce((result, part) => (result << 16n) | BigInt(parseInt(part, 16)), 0n);
}

function ipv6InCidr(address, base, prefix) {
  const value = expandIpv6(address);
  const start = expandIpv6(base);
  if (value === null || start === null) return false;
  const shift = 128n - BigInt(prefix);
  return (value >> shift) === (start >> shift);
}

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    return ![
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
      ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
    ].some(([base, prefix]) => ipv4InCidr(address, base, prefix));
  }
  if (family === 6) {
    return ![
      ['::', 96], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
      ['2001::', 32], ['2001:2::', 48], ['2001:10::', 28], ['2001:20::', 28],
      ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20], ['5f00::', 16],
      ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
    ].some(([base, prefix]) => ipv6InCidr(address, base, prefix));
  }
  return false;
}

function allowedHosts(config) {
  return new Set((config?.imageSourceHosts || []).map(host => String(host).trim().toLowerCase().replace(/\.$/, '')).filter(Boolean));
}

async function validateRemoteUrl(rawUrl, config, resolver = dns.lookup, deadline) {
  deadline?.throwIfExpired();
  let url;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw pipelineError('REMOTE_URL_BLOCKED', error);
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw pipelineError('REMOTE_URL_BLOCKED');
  if (url.port && url.port !== '443') throw pipelineError('REMOTE_PORT_BLOCKED');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!allowedHosts(config).has(hostname)) throw pipelineError('REMOTE_HOST_BLOCKED');

  let answers;
  try {
    answers = deadline
      ? await deadline.run(() => resolver(hostname, { all: true, verbatim: true }))
      : await resolver(hostname, { all: true, verbatim: true });
  } catch (error) {
    if (error?.code === 'IMAGE_PROCESSING_TIMEOUT') throw error;
    throw pipelineError('REMOTE_DNS_FAILED', error);
  }
  if (!Array.isArray(answers)) answers = [answers];
  const normalizedAnswers = answers.map(answer => ({
    address: answer?.address,
    family: net.isIP(answer?.address),
  }));
  if (!normalizedAnswers.length || normalizedAnswers.some(answer => !answer.family || !isPublicAddress(answer.address))) {
    throw pipelineError('REMOTE_ADDRESS_BLOCKED');
  }
  const chosen = normalizedAnswers[0];
  return { url, address: chosen.address, family: chosen.family, addresses: normalizedAnswers };
}

function requestHttps(url, options) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, options, resolve);
    request.once('error', reject);
  });
}

function readBoundedBody(stream, maxBytes = IMAGE_MAX_BYTES, deadline = createDeadline()) {
  const ownsDeadline = arguments.length < 3;
  const body = new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;

    function cleanup() {
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      stream.removeListener('aborted', onAborted);
    }
    function fail(error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }
    function onData(chunk) {
      try {
        deadline.throwIfExpired();
      } catch (error) {
        stream.destroy();
        fail(error);
        return;
      }
      total += chunk.length;
      if (total > maxBytes) {
        stream.destroy();
        fail(pipelineError('IMAGE_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    }
    function onEnd() {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, total));
    }
    function onError(error) { fail(pipelineError('REMOTE_BODY_FAILED', error)); }
    function onAborted() { fail(pipelineError('REMOTE_BODY_FAILED')); }

    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
    stream.once('aborted', onAborted);
  });

  return deadline.run(() => body, () => stream.destroy())
    .finally(() => { if (ownsDeadline) deadline.finish(); });
}

async function downloadImage(rawUrl, options = {}) {
  const deadline = options.deadline || createDeadline();
  const ownsDeadline = !options.deadline;
  const resolver = options.resolver || dns.lookup;
  const request = options.request || requestHttps;
  const maxBytes = options.maxBytes || IMAGE_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;

  try {
    let currentUrl = rawUrl;
    for (let redirects = 0; ; redirects += 1) {
      deadline.throwIfExpired();
      const validated = await validateRemoteUrl(currentUrl, options.config, resolver, deadline);
      const lookup = (_hostname, _lookupOptions, callback) => callback(null, validated.address, validated.family);
      const response = await deadline.run(
        () => request(validated.url, { lookup, signal: deadline.signal, servername: validated.url.hostname })
      );
      deadline.throwIfExpired();

      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.destroy();
        if (redirects >= maxRedirects) throw pipelineError('TOO_MANY_REDIRECTS');
        const location = response.headers?.location;
        if (!location) throw pipelineError('REMOTE_REDIRECT_INVALID');
        try {
          currentUrl = new URL(location, validated.url).href;
        } catch (error) {
          throw pipelineError('REMOTE_REDIRECT_INVALID', error);
        }
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.destroy();
        throw pipelineError('REMOTE_HTTP_STATUS');
      }

      const declaredLength = response.headers?.['content-length'];
      if (declaredLength !== undefined) {
        if (!/^\d+$/.test(String(declaredLength))) {
          response.destroy();
          throw pipelineError('REMOTE_CONTENT_LENGTH_INVALID');
        }
        if (Number(declaredLength) > maxBytes) {
          response.destroy();
          throw pipelineError('IMAGE_TOO_LARGE');
        }
      }
      return await readBoundedBody(response, maxBytes, deadline);
    }
  } finally {
    if (ownsDeadline) deadline.finish();
  }
}

function imageFormat(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  const prefix = buffer.subarray(0, 512).toString('utf8').replace(/^\uFEFF?\s*/, '').toLowerCase();
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a' || prefix.startsWith('<svg') || prefix.startsWith('<?xml')) return 'blocked';
  return '';
}

function validPng(buffer) {
  let offset = 8;
  let first = true;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const end = offset + length + 12;
    if (end > buffer.length || !/^[A-Za-z]{4}$/.test(type)) return false;
    if (first && (type !== 'IHDR' || length !== 13)) return false;
    first = false;
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw pipelineError('IMAGE_ANIMATED');
    if (type === 'IEND') return length === 0 && end === buffer.length;
    offset = end;
  }
  return false;
}

function validJpeg(buffer) {
  return buffer.length >= 4
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[buffer.length - 2] === 0xff
    && buffer[buffer.length - 1] === 0xd9
    && buffer.subarray(2, buffer.length - 2).indexOf(Buffer.from([0xff, 0xd9])) === -1;
}

function validWebp(buffer) {
  if (buffer.length < 20 || buffer.readUInt32LE(4) + 8 !== buffer.length) return false;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString('ascii');
    const length = buffer.readUInt32LE(offset + 4);
    const end = offset + 8 + length + (length % 2);
    if (end > buffer.length) return false;
    if (type === 'ANIM' || type === 'ANMF') throw pipelineError('IMAGE_ANIMATED');
    offset = end;
  }
  return offset === buffer.length;
}

function structurallyValid(buffer, format) {
  if (format === 'png') return validPng(buffer);
  if (format === 'jpeg') return validJpeg(buffer);
  if (format === 'webp') return validWebp(buffer);
  return false;
}

function decodeError(error) {
  if (error?.code === 'IMAGE_PROCESSING_TIMEOUT') return error;
  if (/pixel limit|dimensions? exceed|too many pixels/i.test(error?.message || '')) {
    return pipelineError('IMAGE_DIMENSIONS_TOO_LARGE', error);
  }
  return pipelineError('IMAGE_INVALID', error);
}

async function decodeAndNormalizeImage(buffer, options = {}) {
  const deadline = options.deadline || createDeadline();
  const ownsDeadline = !options.deadline;
  const maxPixels = options.maxPixels || IMAGE_MAX_PIXELS;
  const maxDimension = options.maxDimension || IMAGE_MAX_DIMENSION;

  try {
    deadline.throwIfExpired();
    const format = imageFormat(buffer);
    if (format === 'blocked' || !format) throw pipelineError('IMAGE_TYPE_BLOCKED');
    if (!structurallyValid(buffer, format)) throw pipelineError('IMAGE_INVALID');

    let pipeline;
    try {
      deadline.throwIfExpired();
      const decoder = options.decoder || require('sharp');
      pipeline = decoder(buffer, { animated: false, limitInputPixels: maxPixels });
      deadline.throwIfExpired();
      pipeline.rotate();
      deadline.throwIfExpired();
      pipeline.resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true });
      deadline.throwIfExpired();
      pipeline.webp();
      deadline.throwIfExpired();
      const { data, info } = await deadline.run(() => pipeline.toBuffer({ resolveWithObject: true }));
      deadline.throwIfExpired();
      return { body: data, mime: 'image/webp', ext: 'webp', width: info.width, height: info.height };
    } catch (error) {
      throw decodeError(error);
    }
  } finally {
    if (ownsDeadline) deadline.finish();
  }
}

async function processRemoteImage(url, options = {}) {
  const deadline = options.deadline || createDeadline();
  const decodeAndNormalize = options.decodeAndNormalize || decodeAndNormalizeImage;
  try {
    const buffer = await downloadImage(url, { ...options, deadline });
    deadline.throwIfExpired();
    return await deadline.run(() => decodeAndNormalize(buffer, { ...options, deadline }));
  } finally {
    deadline.finish();
  }
}

module.exports = {
  IMAGE_DEADLINE_MS,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PIXELS,
  IMAGE_MAX_DIMENSION,
  MAX_REDIRECTS,
  createDeadline,
  isPublicAddress,
  validateRemoteUrl,
  readBoundedBody,
  downloadImage,
  decodeAndNormalizeImage,
  processRemoteImage,
};
