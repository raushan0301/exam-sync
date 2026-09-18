import { Global, Module } from '@nestjs/common';
import { NotificationsOutboxService } from './notifications-outbox.service';

/** Global so every domain module can inject it without re-declaring it — mirrors AuditHookModule. */
@Global()
@Module({
  providers: [NotificationsOutboxService],
  exports: [NotificationsOutboxService],
})
export class NotificationsOutboxModule {}
