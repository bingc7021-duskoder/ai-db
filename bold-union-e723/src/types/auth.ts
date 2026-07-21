import { Env } from '../models/types';

export type UserRole = 'USER' | 'ADMIN' | 'SUPER_ADMIN';

export type Permission =
  | 'CREATE_SCHEMA'
  | 'INSERT_DATA'
  | 'UPDATE_DATA'
  | 'DELETE_DATA'
  | 'QUERY_DATABASE'
  | 'GENERATE_DATABASE'
  | 'CLEAR_DATABASE'
  | 'MANAGE_USERS';

export interface DbUser {
  id: string; // UUID
  google_id: string;
  email: string;
  name: string | null;
  picture: string | null;
  role: UserRole;
  is_active: boolean;
  last_login: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface JWTPayload {
  id: string; // db user id
  googleId: string;
  email: string;
  role: UserRole;
  permissions: Permission[];
  iat: number;
  exp: number;
}

export interface GoogleUserInfo {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

export interface AuthenticatedUser {
  id: string;
  googleId: string;
  email: string;
  role: UserRole;
  permissions: Permission[];
}

export interface AppContext {
  Bindings: Env & {
    JWT_SECRET?: string;
  };
  Variables: {
    user?: AuthenticatedUser;
  };
}
