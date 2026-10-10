import { ScoreEngine } from '../src/students/score-engine';

describe('ScoreEngine', () => {
  const prisma: any = {
    student: { findFirst: jest.fn() },
    scoringConfig: { findUnique: jest.fn() },
    successScoreSnapshot: { create: jest.fn() },
  };
  let engine: ScoreEngine;
  beforeEach(() => {
    jest.clearAllMocks();
    engine = new ScoreEngine(prisma);
    prisma.scoringConfig.findUnique.mockResolvedValue({ weights: { academic: 0.3, attendance: 0.2, lms: 0.15, skills: 0.1, placement: 0.2, engagement: 0.05 }, minimumFactors: 3, attendanceThreshold: 75, academicRiskThreshold: 50, placementRiskThreshold: 50, version: 1 });
    prisma.successScoreSnapshot.create.mockResolvedValue({ calculatedAt: new Date('2026-01-01T00:00:00Z') });
  });

  it('returns insufficient data rather than a guessed score when too few factors exist', async () => {
    prisma.student.findFirst.mockResolvedValue({
      id: 'student-real-db-id', institutionId: 'inst-real-db-id', academicRecords: [], attendanceRecords: [],
      lmsActivities: [], skills: [], placementAssessments: [], engagements: [],
    });
    const result = await engine.calculate('student-real-db-id', 'inst-real-db-id');
    expect(result.status).toBe('INSUFFICIENT_DATA');
    expect(result.score).toBeNull();
    expect(result.missingInputs).toContain('academic');
    expect(prisma.successScoreSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'INSUFFICIENT_DATA', score: null }) }));
  });

  it('computes a deterministic weighted score from stored records and ignores unverified skills', async () => {
    prisma.student.findFirst.mockResolvedValue({
      id: 'student-real-db-id', institutionId: 'inst-real-db-id',
      academicRecords: [{ marks: 80, maxMarks: 100 }],
      attendanceRecords: Array.from({ length: 10 }, (_, i) => ({ status: i < 8 ? 'PRESENT' : 'ABSENT' })),
      lmsActivities: [{ loginCount: 4, assignmentsCompleted: 8, assignmentsAssigned: 10, minutesSpent: 50 }],
      skills: [{ score: 90, verified: true }, { score: 10, verified: false }],
      placementAssessments: [{ aptitudeScore: 80, codingScore: 70, communicationScore: 80, mockInterviewScore: 70 }],
      engagements: [{ points: 50, approved: true }],
    });
    const result = await engine.calculate('student-real-db-id', 'inst-real-db-id');
    expect(result.status).toBe('VALID');
    expect(result.score).toBe(78.5);
    expect(result.factors.skills).toBe(90);
    expect(result.contributions).toHaveProperty('attendance', 16);
    expect(result.missingInputs).toEqual([]);
  });
});
