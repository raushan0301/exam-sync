import { IsString, Matches, MinLength } from 'class-validator';

/**
 * `POST /auth/change-password`. `new_password`'s rule (min 8 chars, at
 * least one digit) is deliberately looser than a typical production
 * policy — this is the strength rule the user explicitly asked for, shown
 * to them as a hint on the change-password screen. It does NOT apply to
 * the deterministic default password itself (that's system-generated, not
 * user-chosen, and can never be used past this one required change).
 */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  current_password!: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @Matches(/\d/, { message: 'Password must contain at least one number.' })
  new_password!: string;
}
