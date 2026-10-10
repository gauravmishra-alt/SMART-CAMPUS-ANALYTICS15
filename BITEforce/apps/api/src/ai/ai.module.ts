import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { StudentsModule } from '../students/students.module';
@Module({ imports: [StudentsModule], controllers: [AiController], providers: [AiService] })
export class AiModule {}
