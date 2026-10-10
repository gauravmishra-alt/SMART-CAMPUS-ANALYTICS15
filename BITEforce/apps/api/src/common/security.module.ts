import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard, RolesGuard } from './security';
@Global()
@Module({ imports: [JwtModule.register({})], providers: [JwtAuthGuard, RolesGuard], exports: [JwtAuthGuard, RolesGuard, JwtModule] })
export class SecurityModule {}
