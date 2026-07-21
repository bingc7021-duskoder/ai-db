import { UserRole, Permission } from '../types/auth';

export interface GoogleLoginRequest {
  credential: string;
  provider: 'google';
}

export interface AuthResponse {
  user: {
    id: string;
    googleId: string;
    email: string;
    name: string | null;
    picture: string | null;
    role: UserRole;
    isActive: boolean;
  };
  token: string;
  permissions: Permission[];
}
