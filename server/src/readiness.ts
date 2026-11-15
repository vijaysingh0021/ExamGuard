import type { StorageInterface } from './storage.js';

export type ReadinessStatus = 'ready' | 'pending' | 'failed' | 'unavailable';

export interface ReadinessCheck {
  id: string;
  status: ReadinessStatus;
  explanation: string;
  lastCheckedAt: string;
  mandatory: boolean;
  remediation: string;
}

export interface AiServiceReadiness {
  check: ReadinessCheck;
  capabilities: {
    faceDetection: boolean;
    phoneDetection: boolean;
    headOrientation: boolean;
    multipleFaces: boolean;
  };
}

export function readinessCheck(
  id: string,
  status: ReadinessStatus,
  explanation: string,
  remediation: string,
  checkedAt = new Date(),
  mandatory = true,
): ReadinessCheck {
  return { id, status, explanation, lastCheckedAt: checkedAt.toISOString(), mandatory, remediation };
}

export function readinessSummary(checks: ReadinessCheck[]) {
  const mandatory = checks.filter(check => check.mandatory);
  const readyCount = mandatory.filter(check => check.status === 'ready').length;
  return {
    ready: readyCount === mandatory.length,
    percentage: mandatory.length ? Math.round((readyCount / mandatory.length) * 100) : 100,
    mandatoryChecks: mandatory.length,
    readyChecks: readyCount,
  };
}

export async function checkAiService(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
  checkedAt = new Date(),
): Promise<AiServiceReadiness> {
  const unavailable = (explanation: string, remediation: string, status: ReadinessStatus = 'unavailable'): AiServiceReadiness => ({
    check: readinessCheck('ai_service', status, explanation, remediation, checkedAt),
    capabilities: { faceDetection: false, phoneDetection: false, headOrientation: false, multipleFaces: false },
  });
  const serviceUrl = env.AI_SERVICE_URL?.trim();
  const serviceToken = env.AI_SERVICE_TOKEN?.trim();
  if (!serviceUrl || !serviceToken || serviceToken.length < 32) {
    return unavailable('The authenticated AI service is not configured.', 'Configure AI_SERVICE_URL and the same 32-character-or-longer AI_SERVICE_TOKEN on the API and AI service.');
  }

  let healthUrl: URL;
  try {
    const base = new URL(serviceUrl);
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    const production = env.NODE_ENV === 'production';
    const validUrl = production
      ? base.protocol === 'https:' && !localHosts.has(base.hostname)
      : base.protocol === 'http:' && localHosts.has(base.hostname);
    if (!validUrl) {
      return unavailable(
        'AI_SERVICE_URL is not valid for this environment.',
        production
          ? 'Set AI_SERVICE_URL to a network-accessible HTTPS AI service; do not use localhost.'
          : 'For local development, set AI_SERVICE_URL to a localhost HTTP endpoint.',
        'failed',
      );
    }
    healthUrl = new URL('/health/ready', base);
  } catch {
    return unavailable('AI_SERVICE_URL is invalid.', 'Set AI_SERVICE_URL to a valid service origin.', 'failed');
  }

  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetchImpl(healthUrl, {
        headers: { Authorization: `Bearer ${serviceToken}` },
        signal: AbortSignal.timeout(2500),
      });
      if (response.status < 500 && response.status !== 429) break;
    } catch {
      if (attempt === 1) {
        return unavailable('The AI service did not respond to its authenticated health check.', 'Start the AI service and verify network access from the API host.');
      }
    }
    if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 150));
  }

  if (!response) return unavailable('The AI service did not respond.', 'Start the AI service and verify network access from the API host.');
  if (response.status === 401) {
    return unavailable('The API and AI service credentials do not match.', 'Set the same AI_SERVICE_TOKEN on the API and AI service.', 'failed');
  }
  if (response.status === 503) {
    return unavailable('AI service authentication is not configured.', 'Set the same 32-character-or-longer AI_SERVICE_TOKEN on the API and AI service.', 'failed');
  }
  if (!response.ok) {
    return unavailable(`The AI service health check returned HTTP ${response.status}.`, 'Check AI service logs and restore its authenticated health endpoint.');
  }

  let health: Record<string, unknown>;
  try {
    health = await response.json() as Record<string, unknown>;
  } catch {
    return unavailable('The AI service returned an invalid health response.', 'Check the AI service version and health endpoint.', 'failed');
  }
  const capabilities = {
    faceDetection: health.mediapipe === 'ready',
    phoneDetection: health.phone_model === 'ready',
    headOrientation: health.looking_away === 'ready',
    multipleFaces: health.multiple_faces === 'ready',
  };
  const missing = [
    !capabilities.faceDetection && 'MediaPipe face detection',
    !capabilities.phoneDetection && 'YOLO phone detection',
    !capabilities.headOrientation && 'head-orientation analysis',
    !capabilities.multipleFaces && 'multiple-face detection',
  ].filter((value): value is string => Boolean(value));
  return {
    check: readinessCheck(
      'ai_service',
      missing.length ? 'unavailable' : 'ready',
      missing.length ? `AI capabilities unavailable: ${missing.join(', ')}.` : 'Authenticated AI service and required models are reachable.',
      missing.length ? 'Configure a compatible YOLO model and restore the required AI service capabilities.' : 'No action needed.',
      checkedAt,
    ),
    capabilities,
  };
}

export async function checkEvidenceStorage(
  storage: StorageInterface,
  checkedAt = new Date(),
): Promise<ReadinessCheck> {
  if (!storage.storageConfigured()) {
    return readinessCheck('evidence_storage', 'unavailable', 'Private evidence storage is not configured.', 'Configure private object storage for production or enable local evidence storage in development.', checkedAt);
  }
  if (!storage.verifyReadiness) {
    return readinessCheck('evidence_storage', 'unavailable', 'Storage configuration exists, but storage reachability cannot be verified.', 'Use a storage provider that supports a live readiness check.', checkedAt);
  }
  try {
    await storage.verifyReadiness();
    return readinessCheck('evidence_storage', 'ready', 'Private evidence storage responded to a live access check.', 'No action needed.', checkedAt);
  } catch {
    return readinessCheck('evidence_storage', 'unavailable', 'Private evidence storage is unreachable or access was denied.', 'Check the storage endpoint, private bucket, credentials, and bucket access permissions.', checkedAt);
  }
}
