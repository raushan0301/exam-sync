import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser } from '../../common/auth/auth.types';

/** Matches API_CONTRACT.md's "Notifications" section exactly: two
 * self-scoped routes, no ADMIN/role restriction beyond being authenticated. */
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notificationsService.listMine(user, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Patch(':id/read')
  async markRead(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markRead(id, user);
  }
}
