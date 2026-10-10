import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard, Roles, RolesGuard } from './common/security';
import { PrismaService } from './prisma.service';
import { DEFAULT_WEIGHTS, ScoreEngine } from './students/score-engine';

const factorKeys = ['academic', 'attendance', 'lms', 'skills', 'placement', 'engagement'] as const;
@Controller('scoring-config')
@UseGuards(JwtAuthGuard)
export class ScoringConfigController {
  constructor(private prisma: PrismaService, private scores: ScoreEngine) {}
  private institutionId(req: any) { if (!req.user.institutionId || req.user.role === Role.SUPER_ADMIN) throw new ForbiddenException('Institution scope is required.'); return req.user.institutionId as string; }
  @Get() async getConfig(@Req() req: any) {
    const institutionId = this.institutionId(req);
    const config = await this.prisma.scoringConfig.findUnique({ where: { institutionId } });
    return config || { institutionId, weights: DEFAULT_WEIGHTS, minimumFactors: 3, attendanceThreshold: 75, academicRiskThreshold: 50, placementRiskThreshold: 50, version: 1, isDefault: true };
  }
  @Put() @UseGuards(RolesGuard) @Roles(Role.INSTITUTION_ADMIN)
  async update(@Req() req: any, @Body() body: any) {
    const institutionId = this.institutionId(req);
    const existing = await this.prisma.scoringConfig.findUnique({ where: { institutionId } });
    const weightsInput = body.weights ?? existing?.weights ?? DEFAULT_WEIGHTS;
    if (!weightsInput || typeof weightsInput !== 'object' || Array.isArray(weightsInput)) throw new BadRequestException('Weights must be an object.');
    const weights: Record<string, number> = {};
    for (const key of factorKeys) {
      const value = Number((weightsInput as any)[key]);
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new BadRequestException(`Weight for ${key} must be from 0 to 1.`);
      weights[key] = value;
    }
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    if (sum <= 0 || Math.abs(sum - 1) > 0.001) throw new BadRequestException(`Weights must add up to 1. Current total: ${sum.toFixed(3)}.`);
    const minimumFactors = body.minimumFactors === undefined ? existing?.minimumFactors ?? 3 : Number(body.minimumFactors);
    if (!Number.isInteger(minimumFactors) || minimumFactors < 2 || minimumFactors > 6) throw new BadRequestException('Minimum factors must be an integer from 2 to 6.');
    const attendanceThreshold = body.attendanceThreshold === undefined ? existing?.attendanceThreshold ?? 75 : Number(body.attendanceThreshold);
    const academicRiskThreshold = body.academicRiskThreshold === undefined ? existing?.academicRiskThreshold ?? 50 : Number(body.academicRiskThreshold);
    const placementRiskThreshold = body.placementRiskThreshold === undefined ? existing?.placementRiskThreshold ?? 50 : Number(body.placementRiskThreshold);
    for (const [label, value] of [['attendance threshold', attendanceThreshold], ['academic risk threshold', academicRiskThreshold], ['placement risk threshold', placementRiskThreshold]] as const) if (!Number.isFinite(value) || value < 0 || value > 100) throw new BadRequestException(`${label} must be from 0 to 100.`);
    const data = { weights, minimumFactors, attendanceThreshold, academicRiskThreshold, placementRiskThreshold, version: (existing?.version ?? 0) + 1, updatedById: req.user.id };
    const updated = existing ? await this.prisma.scoringConfig.update({ where: { institutionId }, data }) : await this.prisma.scoringConfig.create({ data: { institutionId, ...data } });
    await this.prisma.auditLog.create({ data: { institutionId, userId: req.user.id, action: 'SCORING_CONFIG_UPDATED', entityType: 'ScoringConfig', entityId: updated.id, beforeValue: existing as any, afterValue: updated as any } });
    return { ...updated, note: 'Scoring configuration versioned. Existing snapshots are retained for audit; recalculate to apply the new configuration to current student records.' };
  }
  @Post('recalculate') @UseGuards(RolesGuard) @Roles(Role.INSTITUTION_ADMIN)
  async recalculate(@Req() req: any) {
    const institutionId = this.institutionId(req);
    const studentIds = await this.prisma.student.findMany({ where: { institutionId }, select: { id: true }, take: 5000 });
    let valid = 0, insufficient = 0;
    for (const student of studentIds) {
      const result = await this.scores.calculate(student.id, institutionId);
      if (result.status === 'VALID') valid++; else insufficient++;
    }
    await this.prisma.auditLog.create({ data: { institutionId, userId: req.user.id, action: 'SCORING_RECALCULATED', entityType: 'ScoringConfig', metadata: { studentCount: studentIds.length, valid, insufficient } } });
    return { recalculated: studentIds.length, valid, insufficient, limit: 5000, message: studentIds.length === 5000 ? 'The 5,000-student processing limit was reached. Contact the administrator for a larger background job.' : 'Recalculation completed.' };
  }
}
