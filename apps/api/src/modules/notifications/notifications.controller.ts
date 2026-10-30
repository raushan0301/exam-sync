import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NavCountsService } from './nav-counts.service';
import { MarkNavSeenDto } from './dto/mark-nav-seen.dto';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser } from '../../common/auth/auth.types';

/** Matches API_CONTRACT.md's "Notifications" section exactly: two
 * self-scoped routes, no ADMIN/role restriction beyond being authenticated. */
@Controller('me')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly navCounts: NavCountsService,
  ) {}

  @Get('notifications')
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

  @Patch('notifications/:id/read')
  async markRead(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markRead(id, user);
  }

  /** Sidebar badge numbers for the caller's role. */
  @Get('nav-counts')
  async navCountsForMe(@CurrentUser() user: AuthenticatedUser) {
    return { counts: await this.navCounts.countsFor(user) };
  }

  /** The user opened a "new since you looked" page — reset its badge. */
  @Post('nav-seen')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markNavSeen(@CurrentUser() user: AuthenticatedUser, @Body() dto: MarkNavSeenDto) {
    await this.navCounts.markSeen(user, dto.key);
  }
}
