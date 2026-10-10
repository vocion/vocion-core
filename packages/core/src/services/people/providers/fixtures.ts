/**
 * Recorded vendor answers for the people providers' tests — fictional people
 * at fictional companies, each answer also carrying the personal fields a
 * vendor may send (`PERSONAL_VALUES`), so the tests can prove none comes out.
 */

/** Values that must never appear in anything a people provider returns. */
export const PERSONAL_VALUES = [
  '000-00-0000',
  '1990-01-01',
  '12 Fixture Lane',
  'dana.home@personal.example',
  '+1 555 0100',
  '000123456789',
  '011000015',
  '187000.00',
  '61.25',
  'Needs surgery',
] as const;

export const GUSTO_EMPLOYEE = {
  uuid: 'e1a2b3c4-0000-4000-8000-000000000001',
  first_name: 'Jordan',
  last_name: 'Ellis',
  preferred_first_name: null,
  email: 'dana.home@personal.example',
  work_email: 'jordan.ellis@larkfield.example',
  phone: '+1 555 0100',
  date_of_birth: '1990-01-01',
  ssn: '000-00-0000',
  department: 'Operations',
  manager_uuid: 'e1a2b3c4-0000-4000-8000-000000000009',
  terminated: false,
  onboarded: true,
  home_address: { street_1: '12 Fixture Lane', city: 'Springfield', zip: '00000' },
  jobs: [{ title: 'Operations Lead', primary: true, hire_date: '2024-03-04', rate: '187000.00', payment_unit: 'Year', compensations: [{ rate: '187000.00' }] }],
  bank_accounts: [{ account_number: '000123456789', routing_number: '011000015' }],
};

export const GUSTO_PAYROLL = {
  payroll_uuid: 'p9a8b7c6-0000-4000-8000-000000000001',
  processed: true,
  off_cycle: false,
  check_date: '2026-09-30',
  pay_period: { start_date: '2026-09-16', end_date: '2026-09-30' },
  totals: { gross_pay: '84250.00', net_pay: '68900.00', employer_taxes: '6445.13', employee_taxes: '12800.00', employee_benefits_deductions: '2100.00', other_deductions: '450.00', benefits: '7300.00', reimbursements: '300.40', check_amount: '69200.40' },
  employee_compensations: [
    {
      employee_uuid: GUSTO_EMPLOYEE.uuid,
      employee_name: 'Jordan Ellis',
      gross_pay: '187000.00',
      net_pay: '61.25',
      fixed_compensations: [{ name: 'Bonus', amount: '1250.75' }],
      taxes: [{ name: 'Federal Income Tax', employer: false, amount: '1204.55' }, { name: 'Social Security', employer: true, amount: '402.11' }],
      benefits: [{ name: 'Medical', employee_deduction: '112.30', company_contribution: '420.00' }],
      deductions: [{ name: 'Garnishment', amount: '45.00' }],
    },
    {
      employee_uuid: 'e1a2b3c4-0000-4000-8000-000000000002',
      employee_name: 'Riley Chen',
      gross_pay: '5321.88',
      net_pay: '3987.12',
      fixed_compensations: [{ name: 'Bonus', amount: '830.15' }],
      taxes: [{ name: 'Federal Income Tax', employer: false, amount: '987.65' }, { name: 'Social Security', employer: true, amount: '355.20' }],
      benefits: [{ name: 'Medical', employee_deduction: '98.40', company_contribution: '380.00' }],
      deductions: [{ name: 'Garnishment', amount: '210.00' }],
    },
  ],
};

/** One person's figures in `GUSTO_PAYROLL`: none may come out, only their sums. */
export const GUSTO_PER_PERSON_AMOUNTS = ['187000', '61.25', '5321.88', '3987.12', '1250.75', '830.15', '1204.55', '402.11', '112.3', '420', '987.65', '355.2', '98.4', '380', '45', '210'] as const;

export const GUSTO_TIME_OFF = {
  uuid: 't1000000-0000-4000-8000-000000000001',
  status: 'approved',
  request_type: 'vacation',
  employee: { uuid: GUSTO_EMPLOYEE.uuid, full_name: 'Jordan Ellis' },
  employee_note: 'Needs surgery',
  days: { '2026-10-12': '8.000', '2026-10-13': '8.000' },
};

export const RIPPLING_EMPLOYEE = {
  id: '64f0c0ffee0000000000a001',
  name: 'Sam Okafor',
  firstName: 'Sam',
  lastName: 'Okafor',
  workEmail: 'sam.okafor@larkfield.example',
  personalEmail: 'dana.home@personal.example',
  phoneNumber: '+1 555 0100',
  roleState: 'ACTIVE',
  title: 'Support Engineer',
  department: '64f0c0ffee0000000000d001',
  manager: '64f0c0ffee0000000000a009',
  employmentType: 'SALARIED_FT',
  workLocation: { city: 'Boston', country: 'US', streetLine1: '12 Fixture Lane' },
  startDate: '2025-01-06',
  endDate: null,
  ssn: '000-00-0000',
  dob: '1990-01-01',
  homeAddress: { streetLine1: '12 Fixture Lane' },
  compensation: { annualSalary: '187000.00', hourlyWage: '61.25' },
  bankAccount: { accountNumber: '000123456789', routingNumber: '011000015' },
};

export const RIPPLING_DEPARTMENT = { id: '64f0c0ffee0000000000d001', name: 'Customer Success', parent: null };

export const RIPPLING_LEAVE = {
  id: '64f0c0ffee0000000000l001',
  role: RIPPLING_EMPLOYEE.id,
  roleName: 'Sam Okafor',
  status: 'APPROVED',
  startDate: '2026-11-02',
  endDate: '2026-11-03',
  numHours: 16,
  leavePolicy: 'PTO',
  reasonForLeave: 'Needs surgery',
};

export const RIPPLING_PAY_RUN = {
  id: '64f0c0ffee0000000000r001',
  run_state: 'PAID',
  run_type: 'REGULAR',
  check_date: '2026-09-30',
  title: null,
  pay_period: { start_date: '2026-09-16', end_date: '2026-09-30', pay_frequency: 'SEMI_MONTHLY' },
  company_entity_id: '64f0c0ffee0000000000c001',
  country_code: 'US',
};

/**
 * Two workers' payroll records for `RIPPLING_PAY_RUN`, each also carrying a
 * name, a government id and bank details a token might be granted.
 */
export const RIPPLING_PAY_RECORDS = [
  {
    id: 'wpr-a',
    run_id: RIPPLING_PAY_RUN.id,
    worker_id: RIPPLING_EMPLOYEE.id,
    worker_name: 'Sam Okafor',
    ssn: '000-00-0000',
    bank_account: { account_number: '000123456789', routing_number: '011000015' },
    currency: 'USD',
    country_code: 'US',
    gross_pay: '4396.17',
    net_pay: '3271.60',
    summary: { employer_taxes: '267.91', employee_taxes: '780.31', employee_deductions: '304.26', employer_contributions: '439.64', total_garnishments: '40.00' },
    earnings: [
      { earning_code: 'SALARY', earning_category: 'REGULAR', display_name: 'Salary', amount: '4321.17', hours: '80.00', rate: '187000.00' },
      { earning_code: 'EXPENSE_REIMB', earning_category: 'REIMBURSEMENT', display_name: 'Expense reimbursement', amount: '75.00' },
    ],
    taxes: [
      { tax_code: 'FIT', display_name: 'Federal income tax', amount: '512.40', paid_by: 'EMPLOYEE' },
      { tax_code: 'FICA_SS', display_name: 'Social Security', amount: '267.91', paid_by: 'EMPLOYEE' },
      { tax_code: 'FICA_SS', display_name: 'Social Security', amount: '267.91', paid_by: 'EMPLOYER' },
    ],
    deductions: [
      { deduction_code: '401K', display_name: '401(k)', employee_amount: '216.06', employer_amount: '129.64' },
      { deduction_code: 'MED', display_name: 'Medical', employee_amount: '88.20', employer_amount: '310.00' },
    ],
    garnishments: [{ garnishment_code: 'CS', amount: '40.00' }],
  },
  {
    id: 'wpr-b',
    run_id: RIPPLING_PAY_RUN.id,
    worker_id: '64f0c0ffee0000000000a002',
    worker_name: 'Avery Lind',
    ssn: '000-00-0000',
    bank_account: { account_number: '000123456789', routing_number: '011000015' },
    currency: 'USD',
    country_code: 'US',
    gross_pay: '5710.79',
    net_pay: '3975.95',
    summary: { employer_taxes: '383.05', employee_taxes: '1184.38', employee_deductions: '400.46', employer_contributions: '480.47', total_garnishments: '150.00' },
    earnings: [
      { earning_code: 'SALARY', earning_category: 'REGULAR', display_name: 'Salary', amount: '5678.29', hours: '80.00', rate: '61.25' },
      { earning_code: 'EXPENSE_REIMB', earning_category: 'REIMBURSEMENT', display_name: 'Expense reimbursement', amount: '32.50' },
    ],
    taxes: [
      { tax_code: 'FIT', display_name: 'Federal income tax', amount: '801.33', paid_by: 'EMPLOYEE' },
      { tax_code: 'FICA_SS', display_name: 'Social Security', amount: '383.05', paid_by: 'EMPLOYEE' },
      { tax_code: 'FICA_SS', display_name: 'Social Security', amount: '383.05', paid_by: 'EMPLOYER' },
    ],
    deductions: [
      { deduction_code: '401K', display_name: '401(k)', employee_amount: '309.11', employer_amount: '185.47' },
      { deduction_code: 'MED', display_name: 'Medical', employee_amount: '91.35', employer_amount: '295.00' },
    ],
    garnishments: [{ garnishment_code: 'CS', amount: '150.00' }],
  },
];

/** One person's figures in `RIPPLING_PAY_RECORDS`: none may come out, only their sums. */
export const RIPPLING_PER_PERSON_AMOUNTS = ['4396.17', '3271.6', '4321.17', '75', '512.4', '267.91', '216.06', '129.64', '88.2', '310', '40', '5710.79', '3975.95', '5678.29', '32.5', '801.33', '383.05', '309.11', '185.47', '91.35', '295', '150', '780.31', '304.26', '439.64', '1184.38', '400.46', '480.47'] as const;

export const WORKDAY_WORKER = {
  'Employee_ID': '21001',
  'Worker': 'Priya Natarajan',
  'Business_Title': 'Operations Manager',
  'Supervisory_Organization': 'Larkfield Systems — Operations',
  'Manager': 'Lee Hart',
  'Email_-_Work': 'priya.natarajan@larkfield.example',
  'Worker_Type': 'Regular',
  'Location': 'Larkfield HQ',
  'Hire_Date': '2022-07-11',
  'Active': '1',
  'National_ID': '000-00-0000',
  'Date_of_Birth': '1990-01-01',
  'Home_Address': '12 Fixture Lane',
  'Email_-_Home': 'dana.home@personal.example',
  'Phone_-_Home': '+1 555 0100',
  'Total_Base_Pay': '187000.00',
  'Hourly_Rate': '61.25',
  'Bank_Account': '000123456789',
  'Routing_Number': '011000015',
};

export const WORKDAY_TIME_OFF = {
  Worker: 'Priya Natarajan',
  Time_Off_Type: 'Vacation',
  Start_Date: '2026-12-21',
  End_Date: '2026-12-24',
  Status: 'Approved',
  Units: '32',
  Comment: 'Needs surgery',
};
