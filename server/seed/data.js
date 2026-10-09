/**
 * Reference data for seeding.
 *
 * ALLOCATIONS are taken verbatim (₹ crore) from the Union Budget of India:
 *   - Budget Estimates (BE) 2026-27, and BE / Revised Estimates (RE) 2025-26,
 *   - as compiled in PRS Legislative Research, "Union Budget 2026-27: Analysis of Expenditure by
 *     Ministries" (March 2026), sourced from the Expenditure Budget / Expenditure Profile 2026-27.
 *     https://prsindia.org/budgets/parliament  •  https://www.indiabudget.gov.in
 *
 * EXPENDITURE TRANSACTIONS: transaction-level government payment data is not public, so monthly
 * expenditure is derived deterministically (no random numbers) from the published figures:
 *   - FY 2025-26 (closed): the year's total spend equals the published RE 2025-26 exactly.
 *   - FY 2026-27 (running): spend = BE 2026-27 x execution ratio x monthly release profile, where the
 *     execution ratio is the scheme's published RE/BE ratio for 2025-26 when available (1.0 otherwise)
 *     and the release profile reflects how that type of spending is released (salaries monthly,
 *     PM-KISAN in instalments, centrally sponsored schemes in tranches, etc.).
 */

const PRS_SOURCE =
  'Union Budget 2026-27 (Expenditure Budget / Profile), as compiled in PRS Legislative Research, "Union Budget 2026-27: Analysis of Expenditure by Ministries", March 2026';

const departments = [
  { code: 'MOD', name: 'Ministry of Defence', description: 'Defence services (Army, Navy, Air Force), defence pensions, capital acquisitions and civil organisations.' },
  { code: 'MORTH', name: 'Ministry of Road Transport and Highways', description: 'National highways (NHAI), roads & bridges and road safety.' },
  { code: 'MOR', name: 'Ministry of Railways', description: 'Railway capital expenditure: new lines, doubling, rolling stock, track renewals and passenger amenities.' },
  { code: 'MHA', name: 'Ministry of Home Affairs', description: 'Central police forces, census operations and transfers to Union Territories.' },
  { code: 'MORD', name: 'Ministry of Rural Development', description: 'Rural employment guarantee, rural housing, livelihoods, rural roads and social assistance.' },
  { code: 'MOAFW', name: "Ministry of Agriculture and Farmers' Welfare", description: 'Income support, credit subvention, crop insurance and agricultural development schemes.' },
  { code: 'MOE', name: 'Ministry of Education', description: 'School education (Samagra Shiksha, PM POSHAN, PM SHRI) and higher education institutions.' },
  { code: 'MOHFW', name: 'Ministry of Health and Family Welfare', description: 'National Health Mission, AB-PMJAY, health infrastructure, research and CGHS.' },
  { code: 'MOJS', name: 'Ministry of Jal Shakti', description: 'Rural drinking water (Jal Jeevan Mission), irrigation, river rejuvenation and interlinking.' },
  { code: 'MOHUA', name: 'Ministry of Housing and Urban Affairs', description: 'Urban housing (PMAY-U), metro rail, urban missions and civic infrastructure.' },
];

// Monthly release profiles, April -> March (each sums to 1).
const PROFILES = {
  FLAT: Array(12).fill(1 / 12),
  STANDARD: [0.065, 0.07, 0.08, 0.075, 0.07, 0.09, 0.075, 0.075, 0.085, 0.085, 0.095, 0.135],
  FRONT: [0.14, 0.14, 0.13, 0.1, 0.08, 0.08, 0.06, 0.06, 0.06, 0.05, 0.05, 0.05],
  LIABILITY: [0.28, 0.22, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.02, 0.02, 0.01, 0.01],
  BACK: [0.04, 0.05, 0.06, 0.06, 0.06, 0.07, 0.07, 0.08, 0.09, 0.1, 0.12, 0.2],
  CAPEX: [0.08, 0.08, 0.09, 0.08, 0.08, 0.09, 0.08, 0.08, 0.08, 0.08, 0.08, 0.1],
  INSTALMENT: [0, 0, 0, 0, 0.33, 0, 0, 0.33, 0, 0, 0.34, 0], // Aug, Nov, Feb instalments
  QUARTERLY: [0, 0, 0.25, 0, 0, 0.25, 0, 0, 0.25, 0, 0, 0.25], // released at the end of each quarter
  STALLED: [0.18, 0.12, 0.08, 0, 0, 0, 0, 0, 0.12, 0.15, 0.15, 0.2], // releases paused mid-year
};

// Transaction line templates per spending "kind": [category, description, payee]
const KINDS = {
  SALARY: [
    ['Salaries & Wages', 'Pay & allowances – {t}', 'Pay & Accounts Office'],
    ['Salaries & Wages', 'Allowances, arrears & overtime – {t}', 'Pay & Accounts Office'],
    ['Administrative Expenses', 'Establishment & office expenses – {t}', 'Drawing & Disbursing Officer'],
  ],
  PENSION: [
    ['Pensions', 'Monthly pension disbursement (SPARSH) – {t}', 'SPARSH / Pension Disbursing Banks'],
    ['Pensions', 'Family pension & commutation – {t}', 'SPARSH / Pension Disbursing Banks'],
    ['Pensions', 'Gratuity & leave encashment – {t}', 'Principal CDA (Pensions)'],
  ],
  CAPEX: [
    ['Capital Works', 'Contract milestone payment – {t}', 'Executing agency / contractor'],
    ['Procurement', 'Equipment & stores procurement – {t}', 'Supplier (GeM / contract)'],
    ['Capital Works', 'Civil works, land & consultancy – {t}', 'Executing agency / contractor'],
  ],
  MAINT: [
    ['Maintenance & Operations', 'Repair & maintenance – {t}', 'Service providers'],
    ['Maintenance & Operations', 'Stores, fuel & utilities – {t}', 'Suppliers'],
    ['Administrative Expenses', 'Office & establishment expenses – {t}', 'Drawing & Disbursing Officer'],
  ],
  SCHEME: [
    ['Grants-in-Aid to States', 'Central share release to States/UTs – {t}', 'State Nodal Accounts (SNA-SPARSH)'],
    ['Grants-in-Aid to States', 'Additional tranche to States/UTs – {t}', 'State Nodal Accounts (SNA-SPARSH)'],
    ['Administrative Expenses', 'Programme management, IEC & MIS – {t}', 'Central Project Management Unit'],
  ],
  DBT: [
    ['Direct Benefit Transfer', 'DBT to beneficiaries – {t}', 'Beneficiary accounts via PFMS'],
    ['Direct Benefit Transfer', 'DBT batch (states) – {t}', 'Beneficiary accounts via PFMS'],
    ['Administrative Expenses', 'Administrative & verification costs – {t}', 'Implementing agencies'],
  ],
  INSTITUTION: [
    ['Grants to Institutions', 'Grant-in-aid (salaries) – {t}', 'Autonomous institutions'],
    ['Grants to Institutions', 'Grant-in-aid (general) – {t}', 'Autonomous institutions'],
    ['Grants to Institutions', 'Grant-in-aid (creation of capital assets) – {t}', 'Autonomous institutions'],
  ],
  SUBSIDY: [
    ['Subsidy', 'Claims settled – {t}', 'Banks / NABARD / insurers'],
    ['Subsidy', 'Claims settled (second batch) – {t}', 'Banks / NABARD / insurers'],
    ['Administrative Expenses', 'Scheme administration – {t}', 'Implementing agencies'],
  ],
  TRANSFER: [['Grants-in-Aid to States', 'Instalment of central assistance – {t}', 'Government of UT of Jammu & Kashmir']],
  LEASE: [['Capital Works', 'Lease rental (capital component) – {t}', 'Indian Railway Finance Corporation']],
  KISAN: [['Direct Benefit Transfer', 'PM-KISAN instalment released to eligible farmers', 'Beneficiary accounts via PFMS']],
};

const SPIKE_LINE = {
  'MOD-CAP': ['Procurement', 'Advance payment on major platform acquisition contract – Capital Outlay', 'Defence acquisition contract (OEM)'],
  'MHA-POL': ['Procurement', 'Bulk procurement of vehicles & equipment for CAPFs', 'Supplier (GeM / contract)'],
  'MOR-RS': ['Procurement', 'Bulk payment for locomotives & coaches (production units)', 'Railway production units / OEM'],
};

/**
 * FY 2026-27 budget lines.
 * [dept, short, title, BE 2026-27, expenditureType, kind, profile, { be25, re25 }, spikeMonthIndex]
 */
const FY27 = [
  ['MOD', 'SAL', 'Defence Services – Salaries', 171044, 'REVENUE', 'SALARY', 'FLAT', { re25: 166064 }],
  ['MOD', 'PEN', 'Defence Pensions', 171338, 'REVENUE', 'PENSION', 'FLAT', { re25: 169187 }],
  ['MOD', 'CAP', 'Capital Outlay on Defence Services', 231010, 'CAPITAL', 'CAPEX', 'CAPEX', { re25: 197417 }, 5],
  ['MOD', 'MNT', 'Defence Services – Maintenance', 92870, 'REVENUE', 'MAINT', 'STANDARD', { re25: 93321 }],
  ['MOD', 'OTH', 'Defence – Other Expenses', 118416, 'REVENUE', 'MAINT', 'STANDARD', { re25: 106523 }],

  ['MORTH', 'NHAI', 'National Highways Authority of India (NHAI)', 187293, 'CAPITAL', 'CAPEX', 'CAPEX', { re25: 170266 }],
  ['MORTH', 'RNB', 'Roads and Bridges', 121999, 'CAPITAL', 'CAPEX', 'STANDARD', { re25: 116337 }],
  ['MORTH', 'RTS', 'Road Transport and Safety', 400, 'REVENUE', 'SCHEME', 'STANDARD', { re25: 360 }],

  ['MOR', 'NL', 'New Lines (Construction)', 36722, 'CAPITAL', 'CAPEX', 'CAPEX', { be25: 32235, re25: 30632 }],
  ['MOR', 'DBL', 'Doubling', 37750, 'CAPITAL', 'CAPEX', 'CAPEX', { be25: 32000, re25: 29026 }],
  ['MOR', 'RS', 'Rolling Stock', 65497, 'CAPITAL', 'CAPEX', 'CAPEX', { be25: 58895, re25: 63373 }, 3],
  ['MOR', 'TR', 'Track Renewals', 22853, 'CAPITAL', 'CAPEX', 'CAPEX', { be25: 22800, re25: 25166 }],
  ['MOR', 'LA', 'Leased Assets – Payment of Capital Component', 39650, 'CAPITAL', 'LEASE', 'QUARTERLY', { be25: 27905, re25: 28157 }],
  ['MOR', 'CA', 'Customer Amenities', 11972, 'CAPITAL', 'CAPEX', 'CAPEX', { be25: 12118, re25: 12121 }],
  ['MOR', 'RSW', 'Road Safety Works – Road Over/Under Bridges', 8225, 'CAPITAL', 'CAPEX', 'CAPEX', { be25: 7000, re25: 7734 }],
  ['MOR', 'EL', 'Electrification Projects', 5000, 'CAPITAL', 'CAPEX', 'CAPEX', { be25: 6150, re25: 4500 }],

  ['MHA', 'POL', 'Police (Central Armed Police Forces & modernisation)', 173803, 'REVENUE', 'SALARY', 'FLAT', { re25: 162283 }, 4],
  ['MHA', 'CEN', 'Census and Statistics', 6000, 'REVENUE', 'SCHEME', 'FRONT', { re25: 1040 }],
  ['MHA', 'JK', 'Transfers to UT of Jammu and Kashmir', 43290, 'REVENUE', 'TRANSFER', 'QUARTERLY', {}],

  ['MORD', 'VBG', 'VB-G RAM G (rural employment guarantee)', 95692, 'REVENUE', 'SCHEME', 'FRONT', {}],
  ['MORD', 'NREGS', 'MGNREGS (transition & pending liabilities)', 30000, 'REVENUE', 'SCHEME', 'LIABILITY', { be25: 86000, re25: 88000 }],
  ['MORD', 'PMAYG', 'Pradhan Mantri Awas Yojana – Gramin', 54917, 'REVENUE', 'DBT', 'STANDARD', { be25: 54832, re25: 32500 }],
  ['MORD', 'NRLM', 'National Rural Livelihood Mission (DAY-NRLM)', 19200, 'REVENUE', 'SCHEME', 'STANDARD', { re25: 16000 }],
  ['MORD', 'PMGSY', 'Pradhan Mantri Gram Sadak Yojana', 19000, 'CAPITAL', 'SCHEME', 'BACK', { re25: 11000 }],
  ['MORD', 'NSAP', 'National Social Assistance Programme', 9671, 'REVENUE', 'DBT', 'FLAT', { re25: 9197 }],

  ['MOAFW', 'KISAN', 'PM-KISAN Samman Nidhi', 63500, 'REVENUE', 'KISAN', 'INSTALMENT', { be25: 63500, re25: 63500 }],
  ['MOAFW', 'MISS', 'Modified Interest Subvention Scheme', 22600, 'REVENUE', 'SUBSIDY', 'STANDARD', { be25: 22600, re25: 22600 }],
  ['MOAFW', 'CIS', 'Crop Insurance Scheme (PMFBY)', 12200, 'REVENUE', 'SUBSIDY', 'STANDARD', { re25: 12267 }],
  ['MOAFW', 'KY', 'Krishonnati Yojana', 11200, 'REVENUE', 'SCHEME', 'BACK', { re25: 6800 }],
  ['MOAFW', 'RKVY', 'Rashtriya Krishi Vikas Yojana', 8550, 'REVENUE', 'SCHEME', 'STANDARD', { re25: 7000 }],
  ['MOAFW', 'AASHA', 'PM Annadata Aay Sanrakshan Abhiyan (PM-AASHA)', 7200, 'REVENUE', 'SUBSIDY', 'BACK', { re25: 6941 }],

  ['MOE', 'SS', 'Samagra Shiksha', 42100, 'REVENUE', 'SCHEME', 'STANDARD', { be25: 41250, re25: 38000 }],
  ['MOE', 'POSHAN', 'PM POSHAN', 12750, 'REVENUE', 'SCHEME', 'STANDARD', { re25: 10600 }],
  ['MOE', 'SHRI', 'PM SHRI Schools', 7500, 'REVENUE', 'SCHEME', 'BACK', { re25: 4500 }],
  ['MOE', 'CU', 'Central Universities', 17440, 'REVENUE', 'INSTITUTION', 'FLAT', { re25: 17085 }],
  ['MOE', 'IIT', 'Indian Institutes of Technology', 12123, 'REVENUE', 'INSTITUTION', 'FLAT', { re25: 11525 }],
  ['MOE', 'UGC', 'UGC and AICTE', 3939, 'REVENUE', 'INSTITUTION', 'STANDARD', { re25: 3691 }],

  ['MOHFW', 'NHM', 'National Health Mission', 39390, 'REVENUE', 'SCHEME', 'STANDARD', { be25: 37227, re25: 37100 }],
  ['MOHFW', 'PMJAY', 'Pradhan Mantri Jan Arogya Yojana (AB-PMJAY)', 9500, 'REVENUE', 'SCHEME', 'STANDARD', { re25: 9000 }],
  ['MOHFW', 'ABHIM', 'PM Ayushman Bharat Health Infrastructure Mission', 4200, 'CAPITAL', 'SCHEME', 'BACK', { re25: 2443 }],
  ['MOHFW', 'ICMR', 'Indian Council of Medical Research', 4000, 'REVENUE', 'INSTITUTION', 'FLAT', { re25: 3150 }],
  ['MOHFW', 'NACO', 'AIDS and STD Control', 3477, 'REVENUE', 'SCHEME', 'STANDARD', { re25: 2662 }],
  ['MOHFW', 'CGHS', 'Central Government Health Scheme', 2358, 'REVENUE', 'MAINT', 'FLAT', { re25: 2207 }],
  ['MOHFW', 'PMSSY', 'Pradhan Mantri Swasthya Suraksha Yojana', 2005, 'CAPITAL', 'CAPEX', 'BACK', { re25: 1500 }],

  ['MOJS', 'JJM', 'Jal Jeevan Mission / National Rural Drinking Water Mission', 67670, 'REVENUE', 'SCHEME', 'STALLED', { be25: 67000, re25: 17000 }],
  ['MOJS', 'PMKSY', 'Pradhan Mantri Krishi Sinchayee Yojana', 7137, 'REVENUE', 'SCHEME', 'STANDARD', { re25: 6922 }],
  ['MOJS', 'NG', 'Namami Gange', 3100, 'REVENUE', 'SCHEME', 'STANDARD', { re25: 2687 }],
  ['MOJS', 'ILR', 'River Interlinking', 1906, 'CAPITAL', 'CAPEX', 'STANDARD', { re25: 1808 }],

  ['MOHUA', 'PMAYU', 'Pradhan Mantri Awas Yojana – Urban', 22025, 'REVENUE', 'SCHEME', 'STALLED', { be25: 25794, re25: 7900 }],
  // Derived line: Ministry total (BE 85,522 / BE25 96,777 / RE25 57,204) less PMAY-U.
  ['MOHUA', 'UD', 'Urban development programmes (Metro, urban missions & others)', 63497, 'CAPITAL', 'SCHEME', 'STANDARD', { be25: 70983, re25: 49304 }],
];

/**
 * FY 2025-26 (closed year): lines where both BE 2025-26 and RE 2025-26 are published.
 * Allocation = BE 2025-26; recorded spend totals RE 2025-26.
 * [dept, short, title, BE 2025-26, RE 2025-26, expenditureType, kind, profile]
 */
const FY26 = [
  ['MORD', 'NREGS', 'Mahatma Gandhi National Rural Employment Guarantee Scheme', 86000, 88000, 'REVENUE', 'SCHEME', 'FRONT'],
  ['MORD', 'PMAYG', 'Pradhan Mantri Awas Yojana – Gramin', 54832, 32500, 'REVENUE', 'DBT', 'STANDARD'],
  ['MOJS', 'JJM', 'Jal Jeevan Mission / National Rural Drinking Water Mission', 67000, 17000, 'REVENUE', 'SCHEME', 'STANDARD'],
  ['MOAFW', 'KISAN', 'PM-KISAN Samman Nidhi', 63500, 63500, 'REVENUE', 'KISAN', 'INSTALMENT'],
  ['MOAFW', 'MISS', 'Modified Interest Subvention Scheme', 22600, 22600, 'REVENUE', 'SUBSIDY', 'STANDARD'],
  ['MOE', 'SS', 'Samagra Shiksha', 41250, 38000, 'REVENUE', 'SCHEME', 'STANDARD'],
  ['MOHFW', 'NHM', 'National Health Mission', 37227, 37100, 'REVENUE', 'SCHEME', 'STANDARD'],
  ['MOHUA', 'PMAYU', 'Pradhan Mantri Awas Yojana – Urban', 25794, 7900, 'REVENUE', 'SCHEME', 'STANDARD'],
  ['MOR', 'NL', 'New Lines (Construction)', 32235, 30632, 'CAPITAL', 'CAPEX', 'CAPEX'],
  ['MOR', 'DBL', 'Doubling', 32000, 29026, 'CAPITAL', 'CAPEX', 'CAPEX'],
  ['MOR', 'RS', 'Rolling Stock', 58895, 63373, 'CAPITAL', 'CAPEX', 'CAPEX'],
  ['MOR', 'TR', 'Track Renewals', 22800, 25166, 'CAPITAL', 'CAPEX', 'CAPEX'],
  ['MOR', 'CA', 'Customer Amenities', 12118, 12121, 'CAPITAL', 'CAPEX', 'CAPEX'],
  ['MOR', 'EL', 'Electrification Projects', 6150, 4500, 'CAPITAL', 'CAPEX', 'CAPEX'],
];

// Demo accounts (also documented in README.md). Change these after first login in production.
const USERS = [
  { name: 'System Administrator', email: 'admin@example.com', role: 'ADMIN', password: 'Admin@12345' },
  { name: 'Chief Finance Officer', email: 'finance@example.com', role: 'FINANCE_OFFICER', password: 'Finance@12345' },
  { name: 'Budget Analyst', email: 'analyst@example.com', role: 'FINANCE_OFFICER', password: 'Finance@12345' },
  ...departments.map((d) => ({
    name: `Head of Department – ${d.code}`,
    email: `head.${d.code.toLowerCase()}@example.com`,
    role: 'DEPARTMENT_HEAD',
    department: d.code,
    password: 'Head@12345',
  })),
];

module.exports = { PRS_SOURCE, departments, PROFILES, KINDS, SPIKE_LINE, FY27, FY26, USERS };
