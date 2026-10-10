# Smart Campus Analytics

A database-first campus-management and student-success platform. The app deliberately ships with **no demo institution, fake students, mock metrics, or sample student records**. The database begins empty; screens render API results and guided empty states.

## Current implementation

- React + TypeScript + Vite dashboard with responsive navigation, onboarding guidance, student directory/create flow, interventions, analytics, and AI assistant panel.
- NestJS REST API under `/api/v1`, Prisma/PostgreSQL schema, secure password hashing, short-lived JWT access tokens, refresh-token rotation via HttpOnly cookies, role-aware guards, and tenant scoping in data services.
- One-time setup endpoint gated by `SETUP_TOKEN`, locked after first Super Admin is created.
- Student create/list/detail, summary analytics, deterministic success-score calculation with explicit insufficient-data handling, interventions, audit logs, and rule-based AI summaries/recommendations.
- Blank CSV template and import validation/preview starter endpoints (see API module). No automatic import applies changes without a separate commit.
- Docker Compose for PostgreSQL, Redis, MinIO, API and web.
- System-only seed script for default score weights and intervention catalog. It does not seed personal or institutional records.

> This is a functional MVP foundation, not a claim that every item in the extensive product brief is production-certified. Before real institutional deployment, complete independent security review, MFA, malware scanning, privacy/retention review, monitoring/alerting, backups/restore drills, load testing, institutional email delivery, and remaining academic/LMS/placement/submission workflows. Optional hosted AI is server-side only; the built-in rule-based provider works without a provider key.

## Prerequisites

- Node.js 20+
- Docker Desktop / Docker Engine with Compose

## Quick start (Docker)

1. Copy `.env.example` to `.env` and replace `SETUP_TOKEN`, JWT secrets, database password, and any other production credentials with unique random values. Do not commit `.env`.
2. Set `POSTGRES_PASSWORD` to a unique URL-safe value (letters, digits, `_` and `-` are easiest) and use unique random values for both JWT secrets and `SETUP_TOKEN`. Compose builds the API connection string from `POSTGRES_PASSWORD`.
3. Run `docker compose up --build` from the project folder.
4. Open `http://localhost:5173`. API health: `http://localhost:4000/api/v1/health`.
5. Use the first-run setup screen. Enter the exact `SETUP_TOKEN` from `.env` to create the initial Super Admin. Setup locks after that account exists.

For a local non-Docker dev loop, install Node.js 20+, start PostgreSQL, copy `.env.example` to `.env`, run `npm install`, `npm run db:generate`, `npm run db:migrate`, then `npm run dev`. The API loads the project-root `.env`; Vite defaults to the local API URL shown above.

## API overview

- `GET /api/v1/setup/status` – first-run status.
- `POST /api/v1/setup/super-admin` – one-time setup (`setupToken`, `name`, `email`, `password`).
- `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`.
- `GET/POST /api/v1/students`, `GET/PATCH /api/v1/students/:id`, `GET /api/v1/students/:id/success-score`.
- `GET /api/v1/analytics/overview`.
- `GET/POST/PATCH /api/v1/interventions` and `/api/v1/interventions/:id`.
- `POST /api/v1/ai/summaries`, `POST /api/v1/ai/chat`, `POST /api/v1/ai/recommendations/students/:id`, `GET /api/v1/ai/health`.
- `GET /api/v1/imports/students/template`, `POST /api/v1/imports/students/preview`.

The backend validates input and scopes all institution-level records to the authenticated user's institution. Super Admin accounts are platform administrators and do not implicitly gain access to private student records.

## Scoring model

The deterministic score uses the configured weighted factors: academic performance, attendance, LMS engagement, skills, placement readiness, and campus engagement. A factor is included only when its underlying records exist. If too little data is available, the API returns `status: "INSUFFICIENT_DATA"`, missing inputs, and no score rather than fabricating a result. The engine is a transparent formula, not a trained prediction model. AI may explain the calculation but never changes official scores or records.

## Security notes

- Keep all secrets in server-side environment variables. Never put `AI_API_KEY` in `VITE_*` variables.
- Set `CORS_ORIGIN` to the exact web origin. Terminate TLS at a trusted reverse proxy for production.
- The project uses Argon2 password hashing, hashed refresh tokens, HttpOnly/SameSite refresh cookies, request validation, Helmet headers, throttling, and audit records for key mutations. Configure strong unique secrets before exposure to a network.
- The setup route is one-time and requires `SETUP_TOKEN`; protect the token as an installation secret.
- Hosted AI is opt-in and server-side. The default is deterministic rule-based output. Do not feed untrusted submissions directly to a provider; use the scoped context builder and validate output.
- Review `SECURITY.md` before deployment.

## Build and tests

- `npm test` runs the API unit tests, including deterministic scoring and insufficient-data behavior.
- `npm run build` builds both the API and web projects.
- `docker compose up --build` generates Prisma Client, pushes the Prisma schema into an empty local database, runs the configuration-only seed, and starts the API and web server.

## Scope of this build

This source package is an MVP implementation, not yet a production-certified release of every item in the larger brief. The delivered core includes setup/login, multi-tenant institution structure, student records, scoring, several performance-data entry endpoints, dashboards, interventions, invitation links, student CSV/XLSX preview and commit, analytics, audit records, and a rule-based AI fallback with optional server-side OpenAI support. Remaining work before real institutional use includes a full MFA flow, institutional email delivery, secure object-storage/upload and malware-scanning workflows, full submission/reviewer and correction-request screens/routes, comprehensive endpoint/schema validation and test coverage for every role, robust background-job/caching integration, migration review, and an independent security/privacy review. Data retention, backups, observability, and deployment hardening are also operator responsibilities.

**Verification note:** the source was syntax-parsed locally, but a full dependency-backed build and test suite must still be run in an environment where npm dependencies can be installed. Do not treat a syntax parse as a passing production build.
