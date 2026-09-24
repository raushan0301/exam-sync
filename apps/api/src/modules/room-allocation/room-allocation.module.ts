import { Module } from '@nestjs/common';
import { RoomAllocationController } from './room-allocation.controller';
import { QuizRoomRequestController } from './quiz-room-request.controller';
import { RoomAllocationService } from './room-allocation.service';
import { RoomSuggestionService } from './room-suggestion.service';
import { ExamSessionModule } from '../exam-session';
import { ConflictEngineModule } from '../conflict-engine';
import { RoomsModule } from '../rooms';
import { QuizModule } from '../quiz';

/**
 * RoomAllocationModule — Phase 12 (replaces the Phase 0 empty skeleton).
 * Owns `exam_session_rooms`. Imports ExamSessionModule (session
 * lookup/status guard), ConflictEngineModule (`checkRoomAllocation` —
 * BR-018/BR-022), and RoomsModule (`findAvailable` for auto-mode
 * candidate search).
 */
@Module({
  imports: [ExamSessionModule, ConflictEngineModule, RoomsModule, QuizModule],
  controllers: [RoomAllocationController, QuizRoomRequestController],
  providers: [RoomAllocationService, RoomSuggestionService],
  exports: [RoomAllocationService, RoomSuggestionService],
})
export class RoomAllocationModule {}
