import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AuthenticatedUser, JwtAccessPayload } from './auth.types';

/**
 * Global authentication guard (registered as APP_GUARD in AuthModule).
 *
 * Verifies the access token's signature/expiry, then — per ARCHITECTURE.md
 * §AF's explicit requirement — re-reads the user's current isActive status
 * and role list from the database rather than trusting anything embedded in
 * the token. This is what makes disabling a user or changing their roles
 * take effect immediately, without waiting for the (short-lived) access
 * token to expire.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Authentication required.');
    }

    let payload: JwtAccessPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtAccessPayload>(token, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
    } catch {
      // Never distinguish "expired" from "malformed" from "invalid signature"
      // to the client — all are just "not authenticated" (prevents leaking
      // internal token state; ARCHITECTURE.md §AG "sensitive information
      // leakage").
      throw new UnauthorizedException('Invalid or expired token.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { roles: { include: { role: true } } },
    });

    if (!user || !user.isActive) {
      // Covers both "user deleted since token was issued" and "user
      // disabled since token was issued" — same generic error either way.
      throw new UnauthorizedException('Invalid or expired token.');
    }

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      roles: user.roles.map((ur) => ur.role.name),
    };

    request.user = authenticatedUser;
    return true;
  }

  private extractToken(request: { headers: Record<string, string | undefined> }): string | null {
    const header = request.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      return null;
    }
    return header.slice('Bearer '.length).trim() || null;
  }
}
