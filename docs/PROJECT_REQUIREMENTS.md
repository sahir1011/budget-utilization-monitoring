# Project Requirements Document
## AI-Based Budget Utilization Monitoring System

| | |
| --- | --- |
| **Version** | 1.0 (Phase 1) |
| **Stack** | MEAN: MongoDB, Express.js, Angular 21, Node.js |
| **Deployment** | Vercel (static Angular build + serverless Express API) with MongoDB Atlas |
| **Reference data** | Union Budget of India 2026-27 (BE) and 2025-26 (BE / RE) |

---

## 1. Context and problem statement

Government departments and large enterprises allocate large annual budgets across schemes and units, but utilisation is usually reviewed through periodic manual reports and spreadsheets. Under-spent funds, irregular payments and overruns are often found only at year end, when it is too late to act.

| Problem | How the system addresses it |
| --- | --- |
| No real-time visibility into utilisation | Live utilisation %, time elapsed, burn rate and projection for every budget head |
| Under-utilised funds found late | Under-utilisation, pace-deviation and dormant-funds rules give early warnings mid-year |
| Risk of leakage / irregular spending | Statistical spike detection on every transaction; overspending detection |
| Manual reporting errors | Integer-rupee arithmetic, server-side calculations, validated inputs, automated reports |
| Limited transparency | Dashboards, department summaries, downloadable PDF/CSV reports |
| Weak accountability | Role-based access, alert ownership workflow, full audit trail |

## 2. Objectives

**Primary:** track allocation and expenditure digitally; monitor utilisation % per department; detect anomalies in spending patterns; identify fund-leakage risks; improve transparency and accountability.

**Secondary:** support data-driven decisions; reduce manual reporting; support governance compliance; provide visual dashboards.

## 3. Scope

**In scope (delivered):** budget allocation entry and management · department-wise expenditure tracking · utilisation calculation · rule-based and analytical anomaly detection · dashboards and reports · alert system · role-based access control.

**Out of scope (Phase 1):** national treasury integration · banking integration · advanced predictive forecasting · mobile application.

## 4. Users and roles

| Role | Permissions |
| --- | --- |
| **Admin** | Everything: users and roles, departments, budgets (incl. delete), expenditure, alerts, threshold rules, audit logs, reports |
| **Finance Officer** | Create and revise budgets; record, correct and delete expenditure for every department; manage alerts; run monitoring scans; all reports |
| **Department Head** | Mapped to exactly one department. View that department's budgets, record expenditure against them, upload documents, acknowledge and resolve that department's alerts, and run reports for that department |

Access control is enforced in the API (route guards and department-scoped queries), not only in the UI.

## 5. Functional requirements

### 5.1 User management
| ID | Requirement | Implementation |
| --- | --- | --- |
| FR-U1 | Secure login and authentication | JWT (8h expiry), bcrypt (cost 12), rate limit 20 attempts / 15 min / IP, lockout after 5 failures for 15 min |
| FR-U2 | Role-based access (Finance Officer, Department Head, Admin) | `authorize()` middleware + `departmentScope()` on every query |
| FR-U3 | Department mapping to users | Department Head must have a department (schema validation) |
| FR-U4 | Password management | Change own password; Admin can reset passwords; policy ≥ 8 chars with letters and digits |

### 5.2 Budget management
| ID | Requirement | Implementation |
| --- | --- | --- |
| FR-B1 | Create annual / quarterly allocations | Indian FY (1 Apr – 31 Mar, IST); quarters Q1 Apr–Jun … Q4 Jan–Mar |
| FR-B2 | Assign funds to departments / projects | Each budget head belongs to a department; unique budget code |
| FR-B3 | Modify and update budgets | Allocation revisions need a reason and are kept in revision history. Department and period are locked once expenditure exists. Status Active / Frozen / Closed |

### 5.3 Expenditure tracking
| ID | Requirement | Implementation |
| --- | --- | --- |
| FR-E1 | Record expenditure transactions | Auto-generated transaction ID, amount (₹ crore → integer rupees), date validated within the budget period and not in the future |
| FR-E2 | Upload supporting documents | Up to 3 files per upload (5 per transaction), 2 MB each, PDF/PNG/JPG/CSV/XLS(X)/DOCX, stored in MongoDB, downloads restricted by department |
| FR-E3 | Categorise expenses | 11 categories: Salaries, Pensions, Capital Works, Procurement, Grants-in-Aid to States, DBT, Subsidy, Maintenance, Grants to Institutions, Administrative, Other |

### 5.4 Monitoring and detection
| ID | Requirement | Rule (configurable) |
| --- | --- | --- |
| FR-M1 | Real-time utilisation % | `spent / allocated × 100`, recalculated on every request; time elapsed % from period bounds |
| FR-M2 | Under-utilisation | Utilisation < 40% after ≥ 70% of the period. Severity rises as utilisation falls, and goes up one more level when the unspent balance exceeds ₹10,000 Cr |
| FR-M3 | Abnormal spending spikes | Modified z-score (0.6745·(x − median)/MAD) > 3.5 **and** ≥ 2.5 × the median of the budget's *earlier* transactions (≥ 6 needed), or any single transaction ≥ 40% of the allocation |
| FR-M4 | Deviation beyond approved thresholds | Overspending: CRITICAL when utilisation > 100%; HIGH when ≥ 90% while < 90% of the period has elapsed. Pace deviation: lagging the timeline by > 30 points, or a linear projection > 110% |
| FR-M5 | Dormant funds | No expenditure for ≥ 60 days on an active budget with a balance |
| FR-M6 | Risk score | 0-100 composite of lag, overspend, projection and inactivity → LOW / MODERATE / HIGH / CRITICAL |

The engine runs after every budget or expenditure change (for that budget), on demand ("Run monitoring scan"), after threshold changes, and daily through Vercel Cron.

### 5.5 Alerts and reporting
| ID | Requirement | Implementation |
| --- | --- | --- |
| FR-A1 | Automated alerts | De-duplicated per budget and rule. Severity and message refresh on re-detection, and alerts auto-resolve when the condition clears. Manually resolved alerts are not re-raised at the same or lower severity |
| FR-A2 | Alert workflow | Open → Acknowledged → Resolved (resolution note required), with notes; average response time KPI |
| FR-R1 | Dashboard visualisations | Bar, doughnut, pie and line charts (Chart.js), KPI cards and risk tables |
| FR-R2 | Department-wise summaries | Departments page, department detail and the Reports summary |
| FR-R3 | Downloadable reports | PDF and CSV: department summary, budget register, transactions, alert register, monthly trend |

### 5.6 Admin features
| ID | Requirement | Implementation |
| --- | --- | --- |
| FR-AD1 | Configure threshold rules | Threshold Rules page with validation; saving re-scans every budget |
| FR-AD2 | Manage departments and users | Create, edit and deactivate departments; create users, edit role and department, activate/deactivate, reset password |
| FR-AD3 | Audit logs for financial changes | Every create / update / delete of budgets, expenditure, users, departments and settings, plus logins, lockouts, exports, alert actions and scans, with field-level before/after values, user, role, IP and timestamp |

## 6. Non-functional requirements

| Requirement | Implementation |
| --- | --- |
| Data security and encryption | HTTPS/TLS + HSTS (Vercel), TLS to MongoDB Atlas with encryption at rest (Atlas default), bcrypt password hashes, JWT, helmet headers, NoSQL-injection-safe input handling, upload whitelisting, CSV formula-injection guard |
| Accurate calculations | Money stored as integer rupees; exact ₹ crore ↔ rupee conversion; automated tests confirm totals against the published BE/RE |
| Scalable architecture | Stateless serverless API, cached connection pool, indexed collections, aggregation pipelines, department dimension built in |
| Fast dashboard loading | One aggregation pass per request, lazy-loaded Angular routes, ~96 kB initial transfer (gzip) |
| Reliability | Health endpoint, centralised error handling; monitoring failures never block a financial save |

## 7. User flow

1. User signs in → role-specific dashboard.
2. Admin / Finance Officer creates a budget allocation.
3. The department records expenditure (with documents).
4. The system recalculates utilisation immediately.
5. The monitoring engine checks the thresholds for that budget.
6. Alerts are raised (or auto-resolved) and appear on the dashboard and in the alert centre.
7. Users acknowledge or resolve alerts and download reports.

## 8. Data model

| Collection | Key fields |
| --- | --- |
| `users` | _id (User ID), name, email, role, department, passwordHash, active, lastLoginAt |
| `departments` | _id, code, name, description, active |
| `budgets` | _id (Budget ID), code, title, department, financialYear, periodType, quarter, periodStart/End, allocatedAmount, allocationDate, expenditureType, status, source, priorYear{BE, RE}, revisions[] |
| `expenditures` | txnId (Transaction ID), budget, department, amount, category, date, description, payee, referenceNo, documents[] |
| `documents` | filename, mimeType, size, data, expenditure, uploadedBy |
| `alerts` | alertId, type (UNDER_UTILIZATION / OVERSPENDING / SPIKE / INACTIVITY / PACE_DEVIATION), severity, status, department, budget, expenditure, message, metrics, timestamps |
| `settings` | threshold rules, last monitoring run |
| `auditlogs` | action, entity, entityId, changes{field: {from, to}}, user, role, ip, at |

**Data used:** allocations for 10 ministries / 50 budget heads (FY 2026-27 BE) and 14 heads for FY 2025-26 (BE and RE), from the Union Budget documents via PRS Legislative Research. Transaction-level spend is derived deterministically from these published figures (see README → *Data sources and realism*).

## 9. KPIs and how they are measured

| KPI | Where it appears |
| --- | --- |
| Utilisation % accuracy | Integer arithmetic; automated tests compare against published figures |
| Reduction in under-utilised funds | "Idle & lagging funds" table and Under-utilised counts by department, tracked over time |
| Number of anomalies detected | Alert centre statistics (total detected, by type and severity) |
| Average response time to alerts | Detection → acknowledgement, on the dashboard and in the alert centre |

## 10. Assumptions and constraints

* Departments enter expenditure regularly; detection quality depends on timely data entry.
* Thresholds are predefined and adjustable by Admin.
* No integration with treasury or banking systems in Phase 1.
* Vercel request bodies are capped at 4.5 MB, so uploads are limited to 2 MB per file.

## 11. Deliverables

* This requirements document
* A fully functional MEAN web application (14 interconnected pages)
* Budget monitoring and anomaly-detection module (`server/services/monitoring.js`)
* Dashboard and reporting system (charts, PDF/CSV exports)
* Admin control panel (users, departments, thresholds, audit logs)
* Automated tests (`npm test`)
* Vercel deployment configuration (`vercel.json`)

## 12. Future enhancements (not part of Phase 1)

Advanced AI-based predictive budget forecasting · integration with treasury and ERP systems · mobile dashboard access · machine-learning-based anomaly detection improvements.
