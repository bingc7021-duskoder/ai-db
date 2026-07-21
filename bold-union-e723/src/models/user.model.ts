import { DbUser, UserRole } from '../types/auth';

export class User implements DbUser {
  id: string;
  google_id: string;
  email: string;
  name: string | null;
  picture: string | null;
  role: UserRole;
  is_active: boolean;
  last_login: Date | null;
  created_at: Date;
  updated_at: Date;

  constructor(data: any) {
    this.id = data.id;
    this.google_id = data.google_id;
    this.email = data.email;
    this.name = data.name || null;
    this.picture = data.picture || null;
    this.role = (data.role || 'USER') as UserRole;
    this.is_active = data.is_active !== false;
    this.last_login = data.last_login ? new Date(data.last_login) : null;
    this.created_at = new Date(data.created_at || Date.now());
    this.updated_at = new Date(data.updated_at || Date.now());
  }

  static fromRow(row: any): User {
    return new User(row);
  }

  toJSON() {
    return {
      id: this.id,
      googleId: this.google_id,
      email: this.email,
      name: this.name,
      picture: this.picture,
      role: this.role,
      isActive: this.is_active,
      lastLogin: this.last_login?.toISOString() || null,
      createdAt: this.created_at.toISOString(),
      updatedAt: this.updated_at.toISOString(),
    };
  }
}
