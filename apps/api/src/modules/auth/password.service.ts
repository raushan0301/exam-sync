import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Password hashing, isolated in its own service so there is exactly one
 * place in the codebase that touches raw passwords (ARCHITECTURE.md §AG:
 * "Password hashing: Argon2id ... never reversible encryption").
 * Argon2id is argon2's default variant (balanced against both GPU-cracking
 * and side-channel attacks), used here explicitly rather than argon2i/d.
 */
@Injectable()
export class PasswordService {
  private readonly options: argon2.Options = {
    type: argon2.argon2id,
  };

  async hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, this.options);
  }

  async verify(hash: string, plainPassword: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plainPassword);
    } catch {
      // A malformed/foreign hash should fail verification, not throw.
      return false;
    }
  }
}
