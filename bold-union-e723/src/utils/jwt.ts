/**
 * Base64URL encoding/decoding utilities that safely handle binary data and UTF-8 characters.
 */
function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function stringToBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlToString(base64Url: string): string {
  const bytes = base64UrlToUint8Array(base64Url);
  return new TextDecoder().decode(bytes);
}

/**
 * Signs a payload using HMAC SHA-256 and outputs a JWT string.
 */
export async function signJwt(payload: any, secret: string): Promise<string> {
  if (!secret) {
    throw new Error('JWT signing error: secret is required');
  }

  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = stringToBase64Url(JSON.stringify(header));
  const payloadB64 = stringToBase64Url(JSON.stringify(payload));
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, data);
  const signatureB64 = arrayBufferToBase64Url(signature);
  
  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

/**
 * Verifies a JWT signature and checks its expiration, returning the parsed payload.
 * Throws an error if invalid or expired.
 */
export async function verifyJwt(token: string, secret: string): Promise<any> {
  if (!token) {
    throw new Error('JWT verification error: token is required');
  }
  if (!secret) {
    throw new Error('JWT verification error: secret is required');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  
  const [headerB64, payloadB64, signatureB64] = parts;
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToUint8Array(signatureB64);
  
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  
  const isValid = await crypto.subtle.verify('HMAC', key, signature, data);
  if (!isValid) {
    throw new Error('Invalid JWT signature');
  }
  
  const payload = JSON.parse(base64UrlToString(payloadB64));
  
  // Check expiration (exp is Unix timestamp in seconds)
  if (payload.exp && Date.now() >= payload.exp * 1000) {
    throw new Error('JWT has expired');
  }
  
  return payload;
}
