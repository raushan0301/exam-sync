import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface PublicUser {
  id: string;
  email: string;
  isActive: boolean;
  roles: string[];
  createdAt: Date;
}

/**
 * Owns read/role-assignment access to the users table. Deliberately never
 * returns passwordHash or any refresh-token data (ARCHITECTURE_REVIEW.md
 * task: "Never return passwords, password hashes, secrets, tokens ... in
 * API responses").
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findMe(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    return this.toPublicUser(user);
  }

  async list(params: {
    cursor?: string;
    limit?: number;
    role?: string;
    isActive?: boolean;
  }): Promise<{ items: PublicUser[]; next_cursor: string | null }> {
    const limit = Math.min(params.limit ?? 25, 200);

    const users = await this.prisma.user.findMany({
      take: limit + 1,
      ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
      where: {
        isActive: params.isActive,
        ...(params.role ? { roles: { some: { role: { name: params.role } } } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      include: { roles: { include: { role: true } } },
    });

    const hasMore = users.length > limit;
    const page = hasMore ? users.slice(0, limit) : users;

    return {
      items: page.map((u) => this.toPublicUser(u)),
      next_cursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async assignRole(userId: string, roleName: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException();
    }

    const role = await this.prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      throw new BadRequestException(`Role "${roleName}" does not exist.`);
    }

    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      create: { userId, roleId: role.id },
      update: {},
    });

    return this.findMe(userId);
  }

  private toPublicUser(user: {
    id: string;
    email: string;
    isActive: boolean;
    createdAt: Date;
    roles: { role: { name: string } }[];
  }): PublicUser {
    return {
      id: user.id,
      email: user.email,
      isActive: user.isActive,
      roles: user.roles.map((r) => r.role.name),
      createdAt: user.createdAt,
    };
  }
}
