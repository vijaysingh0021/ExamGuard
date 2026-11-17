export type ReadinessStatus = 'ready' | 'pending' | 'failed' | 'unavailable';

export interface ReadinessCheck {
  id: string;
  status: ReadinessStatus;
  explanation: string;
  lastCheckedAt: string;
  mandatory: boolean;
  remediation: string;
}

export function createReadinessCheck(
  id: string,
  status: ReadinessStatus,
  explanation: string,
  remediation: string,
  checkedAt = new Date(),
  mandatory = true,
): ReadinessCheck {
  return { id, status, explanation, lastCheckedAt: checkedAt.toISOString(), mandatory, remediation };
}

export class MediaCheckError extends Error {
  constructor(
    message: string,
    readonly status: ReadinessStatus,
    readonly remediation: string,
  ) {
    super(message);
    this.name = 'MediaCheckError';
  }
}

export function browserCompatibility(
  userAgent: string,
  secureContext: boolean,
  hasCameraApi: boolean,
  hasScreenCaptureApi: boolean,
): ReadinessCheck {
  const browser = /Edg\//.test(userAgent) ? 'Microsoft Edge'
    : /Chrome\//.test(userAgent) ? 'Google Chrome'
    : /Firefox\//.test(userAgent) ? 'Mozilla Firefox'
    : /Safari\//.test(userAgent) && !/Chrome\//.test(userAgent) ? 'Safari'
    : null;
  const status = !secureContext || !hasCameraApi || !hasScreenCaptureApi
    ? 'failed'
    : browser ? 'ready' : 'unavailable';
  const explanation = !secureContext
    ? 'A secure HTTPS page is required for camera and display access.'
    : !hasCameraApi
      ? 'This browser does not support camera and microphone access.'
      : !hasScreenCaptureApi
        ? 'This browser does not support the required display-sharing API.'
        : browser ? `${browser} exposes the required media APIs.` : 'The browser is not recognized; media API availability cannot establish compatibility.';
  const remediation = status === 'ready'
    ? 'No action needed.'
    : 'Use a current Chrome, Edge, Firefox, or Safari browser on the secure ExamGuard website.';
  return {
    id: 'browser',
    status,
    explanation,
    lastCheckedAt: new Date().toISOString(),
    mandatory: true,
    remediation,
  };
}

function mediaFailure(error: unknown, device: 'camera' | 'microphone' | 'display'): MediaCheckError {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new MediaCheckError(
      `${device === 'display' ? 'Display sharing' : `${device[0].toUpperCase()}${device.slice(1)} access`} was denied.`,
      'failed',
      'Allow this device in your browser permission settings, then retry.',
    );
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') {
    return new MediaCheckError(
      `No usable ${device === 'display' ? 'full display' : device} is available.`,
      'unavailable',
      device === 'display'
        ? 'Connect a display and select Entire screen / Monitor in the browser picker.'
        : `Connect or enable a ${device}, close other apps using it, and retry.`,
    );
  }
  return new MediaCheckError(
    `The ${device === 'display' ? 'display share' : device} check could not be completed.`,
    'unavailable',
    'Check browser permissions and device availability, then retry.',
  );
}

function hasLiveTrack(stream: MediaStream | null | undefined, kind: 'audio' | 'video'): boolean {
  const tracks = kind === 'video' ? stream?.getVideoTracks() : stream?.getAudioTracks();
  return Boolean(tracks?.some(track => track.readyState === 'live' && track.enabled && !track.muted));
}

export function cameraStreamHasLiveTrack(stream: MediaStream | null | undefined): boolean {
  return Boolean(stream?.getVideoTracks().some(track => track.readyState === 'live' && track.enabled));
}

export function cameraStreamIsActive(stream: MediaStream | null | undefined): boolean {
  return hasLiveTrack(stream, 'video');
}

export function microphoneStreamIsActive(stream: MediaStream | null | undefined): boolean {
  return hasLiveTrack(stream, 'audio');
}

export async function requestCameraStream(devices: Pick<MediaDevices, 'getUserMedia'> | null): Promise<MediaStream> {
  if (!devices) throw new MediaCheckError('Camera access is not supported by this browser.', 'unavailable', 'Use a supported browser on HTTPS.');
  let stream: MediaStream;
  try {
    stream = await devices.getUserMedia({ video: true, audio: false });
  } catch (error) {
    throw mediaFailure(error, 'camera');
  }
  if (!cameraStreamIsActive(stream)) {
    stream.getTracks().forEach(track => track.stop());
    throw new MediaCheckError('The camera did not provide an active video track.', 'unavailable', 'Connect or enable a camera, then retry.');
  }
  return stream;
}

export async function requestMicrophoneStream(devices: Pick<MediaDevices, 'getUserMedia'> | null): Promise<MediaStream> {
  if (!devices) throw new MediaCheckError('Microphone access is not supported by this browser.', 'unavailable', 'Use a supported browser on HTTPS.');
  let stream: MediaStream;
  try {
    stream = await devices.getUserMedia({ audio: true, video: false });
  } catch (error) {
    throw mediaFailure(error, 'microphone');
  }
  if (!microphoneStreamIsActive(stream)) {
    stream.getTracks().forEach(track => track.stop());
    throw new MediaCheckError('The microphone did not provide an active audio track.', 'unavailable', 'Connect or enable a microphone, then retry.');
  }
  return stream;
}

export async function requestFullDisplayStream(devices: Pick<MediaDevices, 'getDisplayMedia'> | null): Promise<MediaStream> {
  if (!devices) throw new MediaCheckError('Display sharing is not supported by this browser.', 'unavailable', 'Use a supported browser on HTTPS.');
  let stream: MediaStream;
  try {
    stream = await devices.getDisplayMedia({
      video: { displaySurface: 'monitor' },
      audio: false,
    });
  } catch (error) {
    throw mediaFailure(error, 'display');
  }
  if (!fullDisplayStreamIsActive(stream)) {
    stream.getTracks().forEach(track => track.stop());
    throw new MediaCheckError(
      'Select Entire screen / Monitor; a window or browser tab is not accepted.',
      'failed',
      'Retry sharing and select Entire screen / Monitor in the browser picker.',
    );
  }
  return stream;
}

export function fullDisplayStreamIsActive(stream: MediaStream | null | undefined): boolean {
  const track = stream?.getVideoTracks()[0];
  return Boolean(track && track.readyState === 'live' && track.enabled && !track.muted && track.getSettings().displaySurface === 'monitor');
}

export async function checkCompanionBridge(
  fetchImpl: typeof fetch = fetch,
  checkedAt = new Date(),
): Promise<ReadinessCheck> {
  const unavailable = (explanation: string): ReadinessCheck => ({
    id: 'windows_companion',
    status: 'unavailable',
    explanation,
    lastCheckedAt: checkedAt.toISOString(),
    mandatory: true,
    remediation: 'Use HTTPS (or localhost during development), install and register the institution-provided Windows Companion if needed, open it, grant ExamGuard local-network access when Chrome asks, then retry this check. If permission was denied, allow Local network access in the browser site settings.',
  });
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return unavailable('The Companion bridge requires a secure context. Open ExamGuard over HTTPS or localhost.');
  }
  try {
    const response = await fetchImpl('http://127.0.0.1:43117/health', {
      headers: { Authorization: `Bearer ${getCompanionBridgeToken()}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    if (response.status === 401) return {
      ...unavailable("The local Companion rejected this browser session's authorization. Retry the check once from the trusted ExamGuard website."),
      remediation: 'Confirm you are using the trusted ExamGuard website and that the Companion is open. If authorization is still rejected, restart the Companion and retry.',
    };
    if (!response.ok) return unavailable('The local Companion health endpoint returned an error.');
    const health = await response.json() as { status?: unknown };
    if (health.status !== 'ready') return unavailable('The Companion is installed but its local bridge is not ready.');
    return {
      id: 'windows_companion',
      status: 'ready',
      explanation: 'The registered Windows Companion bridge is reachable on this device.',
      lastCheckedAt: checkedAt.toISOString(),
      mandatory: true,
      remediation: 'No action needed.',
    };
  } catch {
    return unavailable('The Windows Companion is not reachable. Chrome may be waiting for Local network access permission; allow it and click Check Companion again.');
  }
}

let memoryCompanionBridgeToken: string | null = null;
const COMPANION_BRIDGE_TOKEN_KEY = 'examguard:companion-bridge-token';
const COMPANION_BRIDGE_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

export function getCompanionBridgeToken(): string {
  if (memoryCompanionBridgeToken && COMPANION_BRIDGE_TOKEN_PATTERN.test(memoryCompanionBridgeToken)) {
    return memoryCompanionBridgeToken;
  }
  memoryCompanionBridgeToken = null;
  try {
    const stored = window.sessionStorage.getItem(COMPANION_BRIDGE_TOKEN_KEY);
    if (stored && COMPANION_BRIDGE_TOKEN_PATTERN.test(stored)) {
      memoryCompanionBridgeToken = stored;
      return stored;
    }
  } catch {
    // Storage may be disabled; keep the per-tab token in memory instead.
  }
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error('Secure browser randomness is required to connect the Windows Companion.');
  const bytes = cryptoApi.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  memoryCompanionBridgeToken = token;
  try {
    window.sessionStorage.setItem(COMPANION_BRIDGE_TOKEN_KEY, token);
  } catch {
    // Keep using the in-memory token for this page session.
  }
  return token;
}

export function companionBridgeAuthorization(): Record<string, string> {
  return { Authorization: `Bearer ${getCompanionBridgeToken()}` };
}
