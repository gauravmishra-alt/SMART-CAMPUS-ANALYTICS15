import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { ScoreEngine } from './score-engine';
@Module({ controllers: [StudentsController], providers: [StudentsService, ScoreEngine], exports: [StudentsService, ScoreEngine] })
export class StudentsModule {}
