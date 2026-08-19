const { createLogger } = require('./logger');

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_NAME_LENGTH = 80;
const MAX_BODY_LENGTH = 160;
const MAX_MESSAGE_LENGTH = 1024;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_PER_WINDOW = 10;
const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_CIRCUIT_COOLDOWN_MS = 60_000;
const TELEGRAM_API_ENDPOINT = 'https://api.telegram.org';
const CONTROL_AND_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const OWNER_MENTION_LABEL = 'Owner';

const processRuntimeState = {
  windowStart: 0,
  windowCount: 0,
  consecutiveFailures: 0,
  circuitOpenUntil: 0,
};

function singleLine(value, maximum) {
  return String(value ?? '')
    .replace(CONTROL_AND_BIDI_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function createTelegramNotifier({
  botToken,
  chatId,
  ownerUserId,
  logger = createLogger(),
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  windowMs = DEFAULT_WINDOW_MS,
  maxPerWindow = DEFAULT_MAX_PER_WINDOW,
  failureThreshold = DEFAULT_FAILURE_THRESHOLD,
  circuitCooldownMs = DEFAULT_CIRCUIT_COOLDOWN_MS,
  state = processRuntimeState,
} = {}) {
  const token = String(botToken || '').trim();
  const targetChatId = String(chatId || '').trim();
  const ownerUserNumber = Number(ownerUserId);
  const ownerUserEntity = Number.isSafeInteger(ownerUserNumber) && ownerUserNumber > 0
    ? { type: 'text_mention', offset: 0, length: OWNER_MENTION_LABEL.length, user: { id: ownerUserNumber } }
    : null;

  async function notifyNewComment({ commentId, name, body, status } = {}) {
    if (!token || !targetChatId) return false;

    const now = Date.now();
    if (now < state.circuitOpenUntil) {
      logger.error({ event: 'telegram_notify_skipped', errorCode: 'TELEGRAM_CIRCUIT_OPEN' });
      return false;
    }

    if (now - state.windowStart >= windowMs) {
      state.windowStart = now;
      state.windowCount = 0;
    }
    if (state.windowCount >= maxPerWindow) {
      logger.error({ event: 'telegram_notify_skipped', errorCode: 'TELEGRAM_RATE_LIMITED' });
      return false;
    }
    state.windowCount += 1;

    const commentIdLabel = Number.isInteger(Number(commentId)) ? String(commentId) : 'unknown';
    const statusLabel = status === 'approved' ? 'approved' : 'pending review';
    let text = [
      `New ${statusLabel} comment #${commentIdLabel}`,
      `Name: ${singleLine(name, MAX_NAME_LENGTH)}`,
      `Comment: ${singleLine(body, MAX_BODY_LENGTH)}`,
    ].join('\n').slice(0, MAX_MESSAGE_LENGTH);
    const messageEntities = [];
    if (ownerUserEntity) {
      text = `${OWNER_MENTION_LABEL} ${text}`.slice(0, MAX_MESSAGE_LENGTH);
      messageEntities.push(ownerUserEntity);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${TELEGRAM_API_ENDPOINT}/bot${encodeURIComponent(token)}/sendMessage`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: (() => {
          const params = new URLSearchParams({
          chat_id: targetChatId,
          text,
          disable_web_page_preview: 'true',
          });
          if (messageEntities.length) params.set('entities', JSON.stringify(messageEntities));
          return params.toString();
        })(),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('TELEGRAM_HTTP_ERROR');
      state.consecutiveFailures = 0;
      return true;
    } catch (error) {
      const errorCode = error?.name === 'AbortError' ? 'TELEGRAM_TIMEOUT' : 'TELEGRAM_DELIVERY_FAILED';
      state.consecutiveFailures += 1;
      if (state.consecutiveFailures >= failureThreshold) {
        state.circuitOpenUntil = Date.now() + circuitCooldownMs;
        state.consecutiveFailures = 0;
        logger.error({ event: 'telegram_circuit_opened', errorCode });
      }
      logger.error({ event: 'telegram_notify_failed', errorCode });
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { notifyNewComment };
}

module.exports = { createTelegramNotifier };
