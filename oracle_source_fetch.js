'use strict';

const { execFileSync } = require('child_process');

const HELPER = process.env.ML_SOURCE_EGRESS_HELPER || '/usr/local/bin/ml-source-egress';
const ALLOWED_HOST = 'sapl.al.rr.leg.br';
let activated = false;

function responseFromEnvelope(envelope) {
  const body = Buffer.from(envelope.body_base64 || '', 'base64');
  return {
    ok: envelope.status >= 200 && envelope.status < 300,
    status: envelope.status,
    statusText: envelope.reason || '',
    url: envelope.url,
    async text() { return body.toString('utf8'); },
    async json() { return JSON.parse(body.toString('utf8')); },
  };
}

function oracleFetch(url, options = {}) {
  const parsed = new URL(url);
  if (parsed.hostname !== ALLOWED_HOST) throw new Error('fallback Oracle bloqueado para ' + parsed.hostname);
  const payload = {
    url,
    method: String(options.method || 'GET').toUpperCase(),
    headers: Object.fromEntries(Object.entries(options.headers || {}).map(([key, value]) => [key, String(value)])),
    body_base64: options.body === undefined || options.body === null
      ? null
      : Buffer.from(String(options.body), 'utf8').toString('base64'),
  };
  const stdout = execFileSync(HELPER, [], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 75000,
  });
  return responseFromEnvelope(JSON.parse(stdout));
}

async function fetchWithOracleFallback(url, options = {}, timeoutMs = 25000) {
  if (process.env.ML_SOURCE_EGRESS_FORCE === '1') {
    const fallback = oracleFetch(url, options);
    activated = true;
    console.log(`source_route=forced_oracle_2245_${fallback.status} host=${ALLOWED_HOST}`);
    return fallback;
  }
  if (activated) return oracleFetch(url, options);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    const fallback = oracleFetch(url, options);
    activated = true;
    const reason = error && error.name === 'AbortError' ? 'timeout' : 'network_error';
    console.log(`source_route=direct_${reason} -> oracle_2245_${fallback.status} host=${ALLOWED_HOST}`);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
  if (response.status !== 403) return response;
  const fallback = oracleFetch(url, options);
  activated = true;
  console.log(`source_route=direct_403 -> oracle_2245_${fallback.status} host=${ALLOWED_HOST}`);
  return fallback;
}

module.exports = { fetchWithOracleFallback };
