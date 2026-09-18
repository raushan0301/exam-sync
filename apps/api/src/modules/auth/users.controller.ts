import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { AssignRoleDto } from './dto/assign-role.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/**
 * Matches API_CONTRACT.md "Users / RBAC" exactly:
 * GET /users/me (any), GET /users (ADMIN), POST /users/{id}/roles (ADMIN).
 *
 * Scoping note: API_CONTRACT.md groups "Users / RBAC" directly under
 * "Authentication" and IMPLEMENTATION_PLAN.md Phase 1 lists these routes
 * alongside /auth/login et al. under the same phase — so this controller
 * lives in the `auth` module (which owns User/Role/Permission) rather than
 * `administration` (reserved for later, broader admin config). Flagged
 * explicitly since ARCHITECTURE.md §AW doesn't assign user-CRUD to a
 * specific module by name.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findMe(user.id);
  }

  @Roles(ROLE.ADMIN)
  @Get()
  async list(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('role') role?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.usersService.list({
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
      role,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Roles(ROLE.ADMIN)
  @Post(':id/roles')
  async assignRole(@Param('id') id: string, @Body() dto: AssignRoleDto) {
    return this.usersService.assignRole(id, dto.role);
  }
}
