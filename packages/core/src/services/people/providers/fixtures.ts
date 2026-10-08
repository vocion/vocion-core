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
  totals: { gross_pay: '84250.00', net_pay: '61200.40', employer_taxes: '6445.13' },
  employee_compensations: [{ employee_uuid: GUSTO_EMPLOYEE.uuid, gross_pay: '187000.00', net_pay: '61.25' }],
};

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
