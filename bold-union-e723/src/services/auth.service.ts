import { GoogleUserInfo, UserRole, Permission, JWTPayload } from '../types/auth';
import { signJwt, verifyJwt } from '../utils/jwt';

let cachedJwks: any = null;
let cachedJwksExpiry = 0;

async function getGoogleJwks(): Promise<any> {
  const now = Date.now();
  if (cachedJwks && now < cachedJwksExpiry) {
    return cachedJwks;
  }
  console.log('[AuthService] Fetching Google JWKS...');
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) {
    throw new Error('Failed to fetch Google public keys from JWKS endpoint');
  }
  const jwks = await res.json();
  cachedJwks = jwks;
  // Cache keys for 1 hour to optimize performance
  cachedJwksExpiry = now + 3600 * 1000;
  return jwks;
}

function decodeBase64UrlPayload(payloadB64: string): any {
  const base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
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

export class AuthService {
  private googleClientId: string;
  private jwtSecret: string;

  constructor(googleClientId: string, jwtSecret: string) {
    this.googleClientId = googleClientId;
    this.jwtSecret = jwtSecret;
  }

  /**
   * Verifies Google ID Token signature and claims using Web Crypto API.
   */
  public async verifyGoogleToken(token: string): Promise<GoogleUserInfo> {
    if (!token) {
      throw new Error('Google token is empty');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid Google token format');
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    
    let header: any;
    let payload: any;
    try {
      header = decodeBase64UrlPayload(headerB64);
      payload = decodeBase64UrlPayload(payloadB64);
    } catch (e) {
      throw new Error('Failed to parse Google token JSON parts');
    }

    if (header.alg !== 'RS256') {
      throw new Error(`Unsupported Google token algorithm: ${header.alg}`);
    }
    if (!header.kid) {
      throw new Error('Missing kid key ID header in Google token');
    }

    // Verify token claims
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.iss || (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com')) {
      throw new Error('Invalid token issuer: must be accounts.google.com');
    }
    
    if (!this.googleClientId) {
      console.warn('[AuthService] GOOGLE_CLIENT_ID is not configured. Skipping audience check.');
    } else if (!payload.aud || payload.aud !== this.googleClientId) {
      throw new Error('Token audience mismatch: client ID is incorrect');
    }

    if (!payload.exp || nowSec >= payload.exp) {
      throw new Error('Google ID token is expired');
    }

    if (payload.email_verified !== true) {
      throw new Error('Google email is not verified');
    }

    // Verify cryptographic RSA signature
    const jwks = await getGoogleJwks();
    const jwk = jwks.keys.find((k: any) => k.kid === header.kid);
    if (!jwk) {
      throw new Error(`Google signing key not found for kid: ${header.kid}`);
    }

    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: { name: 'SHA-256' },
      },
      false,
      ['verify']
    );

    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = base64UrlToUint8Array(signatureB64);
    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signature,
      data
    );

    if (!isValid) {
      throw new Error('Google token signature verification failed');
    }

    return {
      googleId: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      name: payload.name,
      picture: payload.picture,
    };
  }

  /**
   * Generates a signed application JWT.
   */
  public async generateSessionToken(
    userId: string,
    googleId: string,
    email: string,
    role: UserRole,
    permissions: Permission[]
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    // Expiry set to 24 hours
    const exp = now + 24 * 3600;

    const payload: JWTPayload = {
      id: userId,
      googleId,
      email,
      role,
      permissions,
      iat: now,
      exp,
    };

    return signJwt(payload, this.jwtSecret);
  }

  /**
   * Validates and decodes the application JWT.
   */
  public async verifySessionToken(token: string): Promise<JWTPayload> {
    return verifyJwt(token, this.jwtSecret);
  }

  /**
   * Resolves the list of permissions associated with a given role.
   * Statically mapped for now, but design-compatible with database-driven queries.
   */
  public async getPermissionsForRole(role: UserRole): Promise<Permission[]> {
    switch (role) {
      case 'SUPER_ADMIN':
        return [
          'CREATE_SCHEMA',
          'INSERT_DATA',
          'UPDATE_DATA',
          'DELETE_DATA',
          'QUERY_DATABASE',
          'GENERATE_DATABASE',
          'CLEAR_DATABASE',
          'MANAGE_USERS',
        ];
      case 'ADMIN':
        return [
          'CREATE_SCHEMA',
          'INSERT_DATA',
          'UPDATE_DATA',
          'DELETE_DATA',
          'QUERY_DATABASE',
          'GENERATE_DATABASE',
          'CLEAR_DATABASE',
          'MANAGE_USERS',
        ];
      case 'USER':
        return ['QUERY_DATABASE'];
      default:
        return [];
    }
  }
}
