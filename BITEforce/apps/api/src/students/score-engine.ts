import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export const DEFAULT_WEIGHTS = { academic: 0.30, attendance: 0.20, lms: 0.15, skills: 0.10, placement: 0.20, engagement: 0.05 };
const clamp = (v: number) => Math.max(0, Math.min(100, v));

@Injectable()
export class ScoreEngine {
  constructor(private prisma: PrismaService) {}

  async calculate(studentId: string, institutionId: string) {
    const student = await this.prisma.student.findFirst({ where: { id: studentId, institutionId }, include: {
      academicRecords: true, attendanceRecords: true, lmsActivities: true,
      skills: true, placementAssessments: true, engagements: { where: { approved: true } },
    } });
    if (!student) throw new NotFoundException('Student was not found in your institution.');
    const cfg = await this.prisma.scoringConfig.findUnique({ where: { institutionId } });
    const weights = { ...DEFAULT_WEIGHTS, ...((cfg?.weights && typeof cfg.weights === 'object') ? cfg.weights as Record<string, number> : {}) };
    const factors: Record<string, number | null> = {
      academic: student.academicRecords.length ? clamp(student.academicRecords.reduce((s, r) => s + (r.maxMarks > 0 ? r.marks / r.maxMarks * 100 : 0), 0) / student.academicRecords.length) : null,
      attendance: student.attendanceRecords.length ? clamp(student.attendanceRecords.filter(r => ['PRESENT', 'LATE'].includes(r.status)).length / student.attendanceRecords.length * 100) : null,
      lms: student.lmsActivities.length ? clamp(student.lmsActivities.reduce((s, r) => s + (r.assignmentsAssigned > 0 ? r.assignmentsCompleted / r.assignmentsAssigned * 100 : (r.loginCount > 0 ? Math.min(100, r.loginCount * 10) : 0)), 0) / student.lmsActivities.length) : null,
      skills: (() => {
        const verified = student.skills.filter(r => r.verified && r.score !== null);
        return verified.length ? clamp(verified.reduce((sum, r) => sum + (r.score ?? 0), 0) / verified.length) : null;
      })(),
      placement: (() => {
        const scored = student.placementAssessments.map(r => [r.aptitudeScore, r.codingScore, r.communicationScore, r.mockInterviewScore].filter((v): v is number => v !== null));
        const averages = scored.filter(nums => nums.length).map(nums => nums.reduce((a, b) => a + b, 0) / nums.length);
        return averages.length ? clamp(averages.reduce((sum, value) => sum + value, 0) / averages.length) : null;
      })(),
      engagement: student.engagements.length ? clamp(student.engagements.reduce((s, r) => s + r.points, 0)) : null,
    };
    const missingInputs = Object.keys(factors).filter(key => factors[key] === null);
    const available = Object.entries(factors).filter((entry): entry is [string, number] => entry[1] !== null);
    const minFactors = cfg?.minimumFactors ?? 3;
    if (available.length < minFactors) {
      const snapshot = await this.prisma.successScoreSnapshot.create({ data: {
        studentId, status: 'INSUFFICIENT_DATA', score: null, missingInputs, factorContributions: {}, formulaVersion: String(cfg?.version ?? 1),
      } });
      return { status: 'INSUFFICIENT_DATA', score: null, missingInputs, factors, contributions: {}, thresholds: { attendance: cfg?.attendanceThreshold ?? 75, academicRisk: cfg?.academicRiskThreshold ?? 50, placementRisk: cfg?.placementRiskThreshold ?? 50 }, calculatedAt: snapshot.calculatedAt, explanation: `A valid score requires at least ${minFactors} factors. ${available.length} are currently available.` };
    }
    const weightSum = available.reduce((sum, [key]) => sum + (Number(weights[key]) || 0), 0);
    if (!weightSum) return { status: 'INSUFFICIENT_DATA', score: null, missingInputs, factors, contributions: {}, explanation: 'Available score weights total zero; ask an administrator to correct the scoring configuration.' };
    const contributions: Record<string, number> = {};
    available.forEach(([key, value]) => { contributions[key] = value * (Number(weights[key]) || 0) / weightSum; });
    const score = Math.round(clamp(Object.values(contributions).reduce((a, b) => a + b, 0)) * 100) / 100;
    const threshold = cfg?.academicRiskThreshold ?? 50;
    const academicRisk = factors.academic === null ? 'INSUFFICIENT_DATA' : factors.academic < threshold ? 'HIGH' : factors.academic < threshold + 15 ? 'MEDIUM' : 'LOW';
    const pThreshold = cfg?.placementRiskThreshold ?? 50;
    const placementRisk = factors.placement === null ? 'INSUFFICIENT_DATA' : factors.placement < pThreshold ? 'HIGH' : factors.placement < pThreshold + 15 ? 'MEDIUM' : 'LOW';
    const segment = factors.placement !== null && factors.placement >= 70 && (factors.academic ?? 0) >= 60 ? 'Placement Ready'
      : academicRisk === 'HIGH' ? 'Academic Risk'
      : factors.academic !== null && factors.academic >= 70 && (factors.placement ?? 0) < 55 ? 'Academically Strong with Placement Gap'
      : factors.lms !== null && factors.lms < 50 ? 'Engagement Gap'
      : score >= 80 ? 'High Achievers' : 'Developing';
    const snapshot = await this.prisma.successScoreSnapshot.create({ data: {
      studentId, score, status: 'VALID', academicRisk, placementRisk, segment,
      factorContributions: contributions, missingInputs, formulaVersion: String(cfg?.version ?? 1),
    } });
    return { status: 'VALID', score, missingInputs, factors, contributions, weights, thresholds: { attendance: cfg?.attendanceThreshold ?? 75, academicRisk: cfg?.academicRiskThreshold ?? 50, placementRisk: cfg?.placementRiskThreshold ?? 50 }, academicRisk, placementRisk, segment, calculatedAt: snapshot.calculatedAt, explanation: `Available factors were re-weighted proportionally to 100%. ${missingInputs.length ? `Missing: ${missingInputs.join(', ')}.` : 'All factors are available.'}` };
  }
}
