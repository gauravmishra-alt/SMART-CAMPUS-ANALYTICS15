import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { SetupModule } from './setup/setup.module';
import { StudentsModule } from './students/students.module';
import { AiModule } from './ai/ai.module';
import { PrismaModule } from './prisma.module';
import { SecurityModule } from './common/security.module';
import { InstitutionsController } from './institutions.controller';
import { DataController } from './data.controller';
import { InterventionsController } from './interventions.controller';
import { AnalyticsController } from './analytics.controller';
import { ImportsController } from './imports/imports.controller';
import { HealthController } from './health.controller';
import { InvitationsController, UsersController } from './invitations.controller';
import { ScoringConfigController } from './scoring-config.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule, SecurityModule, AuthModule, SetupModule, StudentsModule, AiModule,
  ],
  controllers: [InstitutionsController, DataController, InterventionsController, AnalyticsController, ImportsController, HealthController, InvitationsController, UsersController, ScoringConfigController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
