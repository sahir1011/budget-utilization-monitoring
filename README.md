# AI-Based Budget Utilization Monitoring System

A MEAN-stack web application (MongoDB · Express · Angular · Node.js) that tracks budget allocation, expenditure and utilisation in real time across departments. It detects under-utilisation, overspending, spending spikes and dormant funds, and raises alerts.

Reference data: **Union Budget of India 2026-27** (Budget Estimates) and **2025-26** (Budget & Revised Estimates) for 10 ministries and 50 schemes / budget heads.

---

## Features

| Area | What it does |
| --- | --- |
| **Authentication & RBAC** | JWT login, bcrypt-hashed passwords, account lockout after 5 failed attempts, login rate-limiting. Three roles: **Admin**, **Finance Officer**, **Department Head** (Department Heads are mapped to one department and only ever see or record that department's data; this is enforced on the server). |
| **Budget management** | Create annual or quarterly allocations (IST-based Indian FY periods), assign them to departments, revise them (a reason is mandatory and kept in revision history), and freeze or close them. |
| **Expenditure tracking** | Record transactions with category, sanction reference and payee. Upload supporting documents (PDF/PNG/JPG/CSV/XLSX/DOCX, 2 MB each, stored in MongoDB). Dates are validated against the budget period. |
| **Monitoring engine** | Runs after every financial change, on demand, and daily via Vercel Cron. It calculates utilisation %, time elapsed, burn rate, year-end projection and a 0-100 **risk score**. |
| **Anomaly detection** | **Under-utilisation** (default: < 40% used after 70% of the period) · **Overspending** (critical > 100%, warning ≥ 90% early in the period) · **Spending spikes** (robust modified z-score using median/MAD against prior transactions only, plus a median-multiple check) · **Dormant funds** (no spend for N days) · **Pace deviation** (lagging the timeline, or projected to exceed the allocation). Alerts are de-duplicated, escalated, and auto-resolved when the condition clears. |
| **Alerts** | Severity levels (Low → Critical), Acknowledge / Resolve / Note workflow, and an average response-time KPI. |
| **Dashboards** | KPI cards, bar charts (allocation vs spend by department), doughnut (budget health), line chart (cumulative utilisation vs linear target), pie chart (spend by category), risk tables. |
| **Reports** | Department summary, budget register, transactions, alert register and monthly trend. Each downloads as **PDF** or **CSV**. |
| **Admin** | Threshold-rule configuration (saving re-scans every budget), user and department management, and an **audit log** with field-level before/after values. |

### Pages (14 interconnected screens)
Login · Dashboard · Budgets · Budget detail · New/Edit budget · Expenditures · Record expenditure · Departments · Department detail · Alerts · Reports · Users & Roles · Threshold Rules · Audit Logs · Profile

---

## Data sources and realism

* **Allocations are real published figures** (₹ crore), taken from the Union Budget 2026-27 Expenditure Budget / Expenditure Profile as compiled in *PRS Legislative Research, "Union Budget 2026-27: Analysis of Expenditure by Ministries" (March 2026)*. See [`server/seed/data.js`](server/seed/data.js); each budget also stores its source citation.
* **FY 2025-26 (closed year):** allocation = BE 2025-26, and recorded spend adds up **exactly** to the published RE 2025-26. Real 2025-26 shortfalls therefore show up as genuine findings, e.g. Jal Jeevan Mission was 25.4% utilised and PMAY-Urban 30.6%.
* **FY 2026-27 (running year):** transaction-level government payment data is not public, so monthly transactions are **derived deterministically (no random numbers)** from the published figures. Spend = BE 2026-27 × the scheme's published 2025-26 RE/BE execution ratio × a release profile suited to the spending type (salaries monthly, PM-KISAN in instalments, centrally sponsored schemes in tranches, capital expenditure front-loaded). The one exception is the release timing for JJM and PMAY-U, which is set to stall mid-year. Their reduced spend still comes from the published ratio, but the pause itself is a modelling choice that demonstrates the dormant-funds rule. The derivation is documented in the seed file.

---

## Run locally

Requirements: Node.js ≥ 20.19 (22 or 24 recommended).

```bash
npm install
npm run dev
```

* Angular app: http://localhost:4200, API: http://localhost:3000/api
* With no `MONGODB_URI` set, the API starts an **in-memory MongoDB** and seeds it automatically. To persist data, copy `.env.example` to `.env` and set `MONGODB_URI`.

Other scripts:

```bash
npm test            # 16 unit + end-to-end API tests (in-memory MongoDB)
npm run build       # production build of the Angular app
npm run seed        # seed an empty database at MONGODB_URI
npm run seed:reset  # wipe and reseed the database at MONGODB_URI
```

### Demo accounts (created by the seed)

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@example.com | Admin@12345 |
| Finance Officer | finance@example.com | Finance@12345 |
| Department Head (any ministry) | head.<code>@example.com, e.g. head.mojs@example.com, head.mod@example.com | Head@12345 |

Change or disable these accounts before using the system with real data.

---

## Deploy to Vercel

The repository is ready for Vercel. The Angular build is served as static files and the Express API runs as a serverless function (`api/index.js`). See [`vercel.json`](vercel.json).

1. **Create a MongoDB Atlas cluster** (the free M0 tier is enough), create a database user, and under *Network Access* allow `0.0.0.0/0` (Vercel uses dynamic IPs). Copy the connection string.
2. **Import the repo in Vercel** (or run `npx vercel` from this folder). Framework preset: *Other*. The build settings come from `vercel.json`.
3. **Set environment variables** in Vercel → Project → Settings → Environment Variables:
   * `MONGODB_URI`: your Atlas connection string
   * `JWT_SECRET`: a long random string
   * `CRON_SECRET`: a random string (Vercel Cron sends it to `/api/monitoring/cron` for the daily scan)
   * `NODE_ENV`: `production`
4. **Deploy.** On the first API request the empty database is seeded automatically (`AUTO_SEED=true` by default).

---

## Architecture

```
client/                 Angular 21 (standalone components, signals, zoneless)
  src/app/core/         API client, auth (JWT interceptor, guards), formatting (₹ crore, IST dates)
  src/app/shared/       Chart.js wrapper, utilisation bar, badges
  src/app/pages/        14 pages (lazy-loaded)
server/
  app.js                Express app (helmet, compression, CORS, auth, routes, error handling)
  models/               Mongoose schemas: User, Department, Budget, Expenditure, Document, Alert, Setting, AuditLog
  services/metrics.js   Utilisation, time elapsed, burn rate, projection, health, risk score
  services/monitoring.js Rule engine + robust statistical spike detection + alert reconciliation
  services/analytics.js Dashboard / department aggregations
  services/exporters.js CSV and PDF report generation
  routes/               REST endpoints
  seed/                 Real budget data + deterministic expenditure derivation
  tests/                node:test unit and API tests
api/index.js            Vercel serverless entry
```

**Accuracy:** money is stored as integer rupees (no floating-point drift). Amounts are entered in ₹ crore with up to 2 decimals (₹1 lakh precision) and converted exactly. Percentages are rounded only for display. The tests check that dashboard totals equal the sum of the published BE figures to the rupee, and that FY 2025-26 spend equals the published RE.

**Security:** bcrypt password hashing, JWT with expiry, server-side role and department scoping on every query, input coercion against NoSQL operator injection, upload type and size limits, helmet security headers, HSTS on Vercel, CSV formula-injection guarding, login rate limiting and lockout, and an audit trail of every change.

Future enhancements from the brief (predictive forecasting, treasury/ERP integration, mobile app, ML-based anomaly detection) are out of scope for this phase.
