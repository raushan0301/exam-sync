import { Global, Module } from '@nestjs/common';
import { AuditHookService } from './audit-hook.service';

/** Global so every future module can inject AuditHookService without re-declaring it. */
@Global()
@Module({
  providers: [AuditHookService],
  exports: [AuditHookService],
})
export class AuditHookModule {}
