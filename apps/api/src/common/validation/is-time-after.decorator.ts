import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

/**
 * Cross-field check for the exam-session create/reschedule DTOs: `end_time`
 * must be strictly after `property` (`start_time`) — both are plain
 * "HH:MM"/"HH:MM:SS" strings, compared lexicographically (valid for
 * zero-padded 24-hour time). Without this, a bad payload (end before
 * start) reaches the DB and only surfaces later, opaquely, when Postgres's
 * `tsrange(session_date+start_time, session_date+end_time)` overlap-
 * exclusion constraint (BR-018) fails to even construct the range — a raw
 * 500, not a clean validation error, and only at ROOM ALLOCATION time,
 * long after the session was created with the bad times.
 */
export function IsTimeAfter(property: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isTimeAfter',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints;
          const relatedValue = (args.object as Record<string, unknown>)[relatedPropertyName];
          if (typeof value !== 'string' || typeof relatedValue !== 'string') return true; // let @Matches on each field own its own format error
          return value > relatedValue;
        },
        defaultMessage(args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints;
          return `end_time must be after ${relatedPropertyName}`;
        },
      },
    });
  };
}
