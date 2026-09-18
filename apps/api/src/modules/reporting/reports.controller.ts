import { Controller, Get, HttpCode, HttpStatus, Param, Post, Res, Body } from '@nestjs/common';
import { Response } from 'express';
import { ReportJob, ReportType } from '@exam-sync/db';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser, ROLE } from '../../common/auth/auth.types';

/** Matches API_CONTRACT.md "Reports" — the 4 documented POST routes + `GET /report-jobs/{id}`, plus the disclosed `GET /report-jobs/{id}/download` (see `ReportsService`'s own doc comment). All ADMIN-only. */
@Controller()
@Roles(ROLE.ADMIN)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post('reports/attendance')
  @HttpCode(HttpStatus.ACCEPTED)
  async createAttendanceReport(@Body() dto: CreateReportDto, @CurrentUser() actor: AuthenticatedUser) {
    return asJobResponse(await this.reportsService.create(ReportType.ATTENDANCE, dto, actor));
  }

  @Post('reports/seating-plan')
  @HttpCode(HttpStatus.ACCEPTED)
  async createSeatingPlanReport(@Body() dto: CreateReportDto, @CurrentUser() actor: AuthenticatedUser) {
    return asJobResponse(await this.reportsService.create(ReportType.SEATING_PLAN, dto, actor));
  }

  @Post('reports/incident-report')
  @HttpCode(HttpStatus.ACCEPTED)
  async createIncidentReport(@Body() dto: CreateReportDto, @CurrentUser() actor: AuthenticatedUser) {
    return asJobResponse(await this.reportsService.create(ReportType.INCIDENT_REPORT, dto, actor));
  }

  @Post('reports/room-utilization')
  @HttpCode(HttpStatus.ACCEPTED)
  async createRoomUtilizationReport(@Body() dto: CreateReportDto, @CurrentUser() actor: AuthenticatedUser) {
    return asJobResponse(await this.reportsService.create(ReportType.ROOM_UTILIZATION, dto, actor));
  }

  /** `GET /report-jobs/{id}` — "status + download URL when ready" (API_CONTRACT.md's literal wording for this route). */
  @Get('report-jobs/:id')
  async getJob(@Param('id') id: string) {
    const job = await this.reportsService.findById(id);
    return {
      job_id: job.id,
      status: job.status,
      download_url: job.resultUrl,
      error_message: job.errorMessage,
    };
  }

  @Get('report-jobs/:id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const file = await this.reportsService.download(id);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.data);
  }
}

function asJobResponse(job: ReportJob): { job_id: string } {
  return { job_id: job.id };
}
