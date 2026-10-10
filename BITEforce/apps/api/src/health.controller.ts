import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}
  @Get() async health() { await this.prisma.$queryRaw`SELECT 1`; return { status: 'ok', service: 'smart-campus-api', time: new Date().toISOString() }; }
}
