import { Controller, Get, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from './common/security';
import { PrismaService } from './prisma.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private prisma: PrismaService) {}
  @Get('overview') async overview(@Req() req: any) {
    const actor = req.user;
    if (!actor.institutionId || actor.role === Role.SUPER_ADMIN) throw new ForbiddenException('Institution scope is required for analytics.');
    const studentWhere: any = { institutionId: actor.institutionId };
    if ([Role.DEPARTMENT_ADMIN, Role.FACULTY].includes(actor.role)) studentWhere.departmentId = actor.departmentId;
    if (actor.role === Role.ACADEMIC_ADVISOR) studentWhere.advisorUserId = actor.id;
    if (actor.role === Role.STUDENT) studentWhere.userId = actor.id;
    const [totalStudents, students, openInterventions, departments, allScores] = await Promise.all([
      this.prisma.student.count({ where: studentWhere }),
      this.prisma.student.findMany({ where: studentWhere, select: { id: true, departmentId: true, department: { select: { name: true } }, scoreSnapshots: { orderBy: { calculatedAt: 'desc' }, take: 1 } }, take: 5000 }),
      actor.role === Role.STUDENT ? Promise.resolve(0) : this.prisma.intervention.count({ where: { institutionId: actor.institutionId, status: { in: ['PENDING', 'IN_PROGRESS'] }, student: studentWhere } }),
      this.prisma.department.findMany({ where: { institutionId: actor.institutionId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.successScoreSnapshot.findMany({ where: { student: studentWhere, status: 'VALID', score: { not: null } }, orderBy: { calculatedAt: 'desc' }, select: { studentId: true, score: true, academicRisk: true, placementRisk: true, segment: true, calculatedAt: true }, take: 10000 }),
    ]);
    const latestByStudent = new Map<string, typeof allScores[number]>();
    for (const s of allScores) if (!latestByStudent.has(s.studentId)) latestByStudent.set(s.studentId, s);
    const latest = [...latestByStudent.values()];
    const average = latest.length ? Math.round((latest.reduce((sum, s) => sum + (s.score ?? 0), 0) / latest.length) * 10) / 10 : null;
    const atRisk = latest.filter(s => s.academicRisk === 'HIGH' || s.placementRisk === 'HIGH').length;
    const placementReady = latest.filter(s => s.segment === 'Placement Ready').length;
    const segments = Object.entries(latest.reduce((acc: Record<string, number>, s) => { const key = s.segment || 'Unclassified'; acc[key] = (acc[key] || 0) + 1; return acc; }, {})).map(([name, value]) => ({ name, value }));
    const deptStats = departments.map(d => {
      const subset = latest.filter(s => students.find(st => st.id === s.studentId)?.departmentId === d.id);
      return { department: d.name, scoredStudents: subset.length, averageScore: subset.length ? Math.round(subset.reduce((n, s) => n + (s.score ?? 0), 0) / subset.length * 10) / 10 : null, atRisk: subset.filter(s => s.academicRisk === 'HIGH' || s.placementRisk === 'HIGH').length };
    }).filter(x => x.scoredStudents || totalStudents === 0);
    return { totalStudents, averageSuccessScore: average, scoredStudents: latest.length, atRiskStudents: atRisk, placementReady, openInterventions, segments, departmentStats: deptStats, dataStatus: totalStudents === 0 ? 'EMPTY' : latest.length === 0 ? 'INSUFFICIENT_DATA' : 'READY', generatedAt: new Date().toISOString() };
  }
}
