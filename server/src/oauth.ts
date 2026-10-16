import { ClientSecretPost, authorizationCodeGrant, buildAuthorizationUrl, calculatePKCECodeChallenge, discovery, randomNonce, randomPKCECodeVerifier, randomState } from 'openid-client';

export type OAuthProvider = 'google' | 'microsoft';
type ProviderSettings = { issuer: string; clientId?: string; clientSecret?: string; label: string };

const settings = (provider: OAuthProvider): ProviderSettings => provider === 'google'
  ? { issuer: 'https://accounts.google.com', clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, label: 'Google' }
  : { issuer: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID || 'common'}/v2.0`, clientId: process.env.MICROSOFT_CLIENT_ID, clientSecret: process.env.MICROSOFT_CLIENT_SECRET, label: 'Microsoft' };

export const configuredProviders = () => (['google', 'microsoft'] as OAuthProvider[]).flatMap(provider => {
  const config = settings(provider);
  return config.clientId && config.clientSecret ? [{ id: provider, label: config.label }] : [];
});

export async function beginAuthorization(provider: OAuthProvider, redirectUri: string) {
  const providerConfig = settings(provider);
  if (!providerConfig.clientId || !providerConfig.clientSecret) throw new Error('This sign-in provider is not configured');
  const configuration = await discovery(new URL(providerConfig.issuer), providerConfig.clientId, { redirect_uris: [redirectUri], response_types: ['code'] }, ClientSecretPost(providerConfig.clientSecret));
  const state = randomState(); const nonce = randomNonce(); const codeVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const url = buildAuthorizationUrl(configuration, { redirect_uri: redirectUri, scope: 'openid profile email', response_type: 'code', state, nonce, code_challenge: codeChallenge, code_challenge_method: 'S256' });
  return { url: url.href, state, nonce, codeVerifier };
}

export async function finishAuthorization(provider: OAuthProvider, redirectUri: string, callbackUrl: string, state: string, nonce: string, codeVerifier: string) {
  const providerConfig = settings(provider);
  if (!providerConfig.clientId || !providerConfig.clientSecret) throw new Error('This sign-in provider is not configured');
  const configuration = await discovery(new URL(providerConfig.issuer), providerConfig.clientId, { redirect_uris: [redirectUri], response_types: ['code'] }, ClientSecretPost(providerConfig.clientSecret));
  const tokens = await authorizationCodeGrant(configuration, new URL(callbackUrl), { expectedState: state, expectedNonce: nonce, pkceCodeVerifier: codeVerifier });
  const claims = tokens.claims();
  if (!claims?.sub || !claims.email || claims.email_verified === false) throw new Error('Provider did not return a verified identity');
  return { subject: claims.sub, email: String(claims.email), name: typeof claims.name === 'string' ? claims.name : undefined };
}
