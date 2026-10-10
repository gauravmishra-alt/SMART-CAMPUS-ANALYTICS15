import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Configuration-only seed: no institution, user, student, score or other personal data.
  const types = [
    ['FACULTY_MENTORING', 'Faculty Mentoring', 'Supportive faculty check-in and follow-up.'],
    ['ATTENDANCE_FOLLOW_UP', 'Attendance Follow-Up', 'Discuss attendance barriers and make a plan.'],
    ['REMEDIAL_LEARNING', 'Remedial Learning', 'Targeted subject practice or tutoring.'],
    ['CODING_WORKSHOP', 'Coding Workshop', 'Practice coding and problem-solving.'],
    ['MOCK_INTERVIEW_TRAINING', 'Mock Interview Training', 'Structured interview practice and feedback.'],
    ['OTHER', 'Other', 'A locally defined support action.'],
  ] as const;
  for (const [key, label, description] of types) await prisma.interventionType.upsert({ where: { key }, update: { label, description, active: true }, create: { key, label, description } });
}
main().finally(() => prisma.$disconnect());
