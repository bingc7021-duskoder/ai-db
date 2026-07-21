import { DatabaseService } from './database.service';
import { User } from '../models/user.model';
import { UserRole } from '../types/auth';

export class UserService {
  private db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  /**
   * Finds a user by their Google ID.
   */
  public async findByGoogleId(googleId: string): Promise<User | null> {
    const result = await this.db.execute(
      'SELECT * FROM app_users WHERE google_id = $1',
      [googleId]
    );
    if (result.rowCount === 0 || !result.rows[0]) {
      return null;
    }
    return User.fromRow(result.rows[0]);
  }

  /**
   * Finds a user by their email address.
   */
  public async findByEmail(email: string): Promise<User | null> {
    const result = await this.db.execute(
      'SELECT * FROM app_users WHERE email = $1',
      [email]
    );
    if (result.rowCount === 0 || !result.rows[0]) {
      return null;
    }
    return User.fromRow(result.rows[0]);
  }

  /**
   * Automatically creates a new user with the default role of 'USER'.
   */
  public async createUser(
    googleId: string,
    email: string,
    name?: string,
    picture?: string
  ): Promise<User> {
    const result = await this.db.execute(
      `INSERT INTO app_users (google_id, email, name, picture, role, is_active, last_login, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'USER', true, NOW(), NOW(), NOW())
       RETURNING *`,
      [googleId, email, name || null, picture || null]
    );

    if (result.rowCount === 0 || !result.rows[0]) {
      throw new Error('Failed to create user in database');
    }
    return User.fromRow(result.rows[0]);
  }

  /**
   * Updates last_login, updated_at, and profile info if updated in Google profile.
   */
  public async updateLastLogin(
    userId: string,
    name?: string,
    picture?: string
  ): Promise<User> {
    const result = await this.db.execute(
      `UPDATE app_users
       SET last_login = NOW(),
           updated_at = NOW(),
           name = COALESCE($2, name),
           picture = COALESCE($3, picture)
       WHERE id = $1
       RETURNING *`,
      [userId, name || null, picture || null]
    );

    if (result.rowCount === 0 || !result.rows[0]) {
      throw new Error(`User with ID ${userId} not found for last login update`);
    }
    return User.fromRow(result.rows[0]);
  }

  /**
   * Retrieves all users. Authorized for ADMIN or SUPER_ADMIN.
   */
  public async findAll(): Promise<User[]> {
    const result = await this.db.execute(
      'SELECT * FROM app_users ORDER BY created_at DESC'
    );
    return result.rows.map((row) => User.fromRow(row));
  }

  /**
   * Updates a user's role.
   */
  public async updateRole(userId: string, role: UserRole): Promise<User> {
    const result = await this.db.execute(
      `UPDATE app_users
       SET role = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [userId, role]
    );

    if (result.rowCount === 0 || !result.rows[0]) {
      throw new Error(`User with ID ${userId} not found for role update`);
    }
    return User.fromRow(result.rows[0]);
  }

  /**
   * Activates or deactivates a user account.
   */
  public async updateStatus(userId: string, isActive: boolean): Promise<User> {
    const result = await this.db.execute(
      `UPDATE app_users
       SET is_active = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [userId, isActive]
    );

    if (result.rowCount === 0 || !result.rows[0]) {
      throw new Error(`User with ID ${userId} not found for status update`);
    }
    return User.fromRow(result.rows[0]);
  }
}
