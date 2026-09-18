import { Global, Module } from '@nestjs/common';
import { ImportJobsController } from './import-jobs.controller';
import { ImportJobsService } from './import-jobs.service';

/** Global so any future bulk-import feature can inject ImportJobsService without re-declaring it. */
@Global()
@Module({
  controllers: [ImportJobsController],
  providers: [ImportJobsService],
  exports: [ImportJobsService],
})
export class ImportJobsModule {}
