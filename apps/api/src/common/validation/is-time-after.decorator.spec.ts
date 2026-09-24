import 'reflect-metadata';
import { validate } from 'class-validator';
import { CreateExamSessionDto } from '../../modules/exam-session/dto/create-exam-session.dto';

/**
 * Regression test for the bug that let `end_time < start_time` reach the
 * DB and crash room allocation with a raw Postgres error (BR-018's
 * tsrange-based exclusion constraint can't even construct an inverted
 * range) — see `IsTimeAfter`'s own header comment.
 */
describe('IsTimeAfter — end_time must be after start_time', () => {
  function makeDto(start_time: string, end_time: string): CreateExamSessionDto {
    const dto = new CreateExamSessionDto();
    dto.name = 'Test Session';
    dto.session_date = '2026-12-01';
    dto.start_time = start_time;
    dto.end_time = end_time;
    return dto;
  }

  it('rejects end_time before start_time', async () => {
    const errors = await validate(makeDto('22:30', '12:30'));
    expect(errors.some((e) => e.property === 'end_time' && e.constraints?.isTimeAfter)).toBe(true);
  });

  it('rejects end_time equal to start_time', async () => {
    const errors = await validate(makeDto('09:00', '09:00'));
    expect(errors.some((e) => e.property === 'end_time' && e.constraints?.isTimeAfter)).toBe(true);
  });

  it('accepts end_time after start_time', async () => {
    const errors = await validate(makeDto('09:00', '11:00'));
    expect(errors.some((e) => e.property === 'end_time')).toBe(false);
  });
});
