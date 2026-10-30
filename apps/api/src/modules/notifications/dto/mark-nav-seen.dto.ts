import { IsIn } from 'class-validator';
import { SEEN_KEYS, SeenKey } from '../nav-counts.service';

export class MarkNavSeenDto {
  @IsIn(SEEN_KEYS as unknown as string[])
  key!: SeenKey;
}
