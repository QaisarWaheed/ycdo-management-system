import {
  ChangeType,
  EmployeeStatus,
  Gender,
  PrismaClient,
  ProjectType,
  StaffType,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function ensureUserPassword(userId: string, plainPassword: string) {
  await prisma.userPassword.upsert({
    where: { userId },
    update: { plainText: plainPassword },
    create: { userId, plainText: plainPassword },
  });
}

async function ensureUserAccount(
  email: string,
  plainPassword: string,
  role: UserRole,
  employeeId?: string | null,
) {
  const hashedPassword = await bcrypt.hash(plainPassword, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      password: hashedPassword,
      role,
      isActive: true,
      ...(employeeId !== undefined ? { employeeId } : {}),
    },
    create: {
      email,
      password: hashedPassword,
      role,
      employeeId: employeeId ?? null,
      isActive: true,
    },
  });
  await ensureUserPassword(user.id, plainPassword);
  return user;
}

type BranchSeed = { name: string; address: string; phone: string };

const hospitalRunningBranches: BranchSeed[] = [
  { name: 'YCDO Central Hospital', address: 'Masoom Shah Road Multan', phone: '0304-2827777' },
  { name: 'YCDO Central Hospital Consultant Floor', address: 'Masoom Shah Road Multan', phone: '0309-7777510' },
  { name: 'YCDO Hospital Hassan Abad', address: 'Hassan Abad Gate #2 Multan', phone: '0305-2827777' },
  { name: 'Idrees Memorial YCDO Hospital', address: 'Inside Qasim Pur Colony Multan', phone: '0306-2827777' },
  { name: 'YCDO Hospital Hassan Parwana', address: 'Hassan Parwana Old Sabzi Mandi Road Multan', phone: '0307-2827777' },
  { name: 'YCDO Hospital Suraj Kund', address: 'Suraj Kund Road Rangeel Pur Multan', phone: '0308-2827777' },
  { name: 'YCDO Executive Hospital-I', address: 'Chowk Ghanta Ghar Multan', phone: '0312-2827777' },
  { name: 'YCDO Executive-I Consultant Floor', address: 'Chowk Ghanta Ghar Multan', phone: '0307-5891888' },
  { name: 'YCDO Executive Hospital-II Mother & Child Care', address: 'LaSalle Road Near Chungi No 9 Multan', phone: '0315-2827777' },
  { name: 'YCDO Hospital Jumma Wala', address: 'Jumma Wala Dunya Pur Road Multan', phone: '0327-2827777' },
  { name: 'YCDO Hospital Bilawal Pur', address: 'Bilawal Pur Tehsil Kabirwala', phone: '0320-2827777' },
  { name: 'YCDO Hospital Pul Dhram Pura', address: 'Pul Dhram Pura Multan Road Abdul Hakeem', phone: '0328-2827777' },
  { name: 'Allah Dad Memorial YCDO Hospital', address: 'Retra Tehsil Tonsa Sharif', phone: '0309-7777517' },
  { name: 'YCDO Diagnostic Centre', address: 'Chowk Ghanta Ghar Multan', phone: '0309-7777515' },
  { name: 'Police & YCDO Drug Rehabilitation Hospital', address: 'Near Jalal Masjid Chowk Gulgasht Colony Multan', phone: '0329-2827777' },
  { name: 'YCDO Hospital Budhla Santt', address: 'Budhla Chowk Budhla Santt Multan', phone: '0309-7777516' },
  { name: 'YCDO Hospital Sikandar Abad', address: 'Sikandar Abad Tehsil Shuja Abad Multan', phone: '0309-7777518' },
  { name: 'YCDO Ghazi National Hospital E-III', address: 'Dera Ghazi Khan', phone: '0324-2827777' },
  { name: 'YCDO AR Executive-IV Hospital', address: 'Choti Zeeren District Dera Ghazi Khan', phone: '0314-2827777' },
  { name: 'YCDO Executive-V Drug Rehabilitation Hospital', address: 'Chowk Rasheed Abad Multan', phone: '0310-2827777' },
  { name: 'YCDO Islamabad Allergy Vaccination Centre', address: 'Chowk Ghanta Ghar Masoom Shah Road Multan', phone: '0303-3333207' },
  { name: 'YCDO Head Office', address: 'Chowk Ghanta Ghar Multan', phone: '0303-3333207' },
];

const hospitalDevBranches: BranchSeed[] = [
  { name: 'YCDO Medical Complex', address: 'Masoom Shah Road Multan', phone: '' },
  { name: 'YCDO Executive Hospital-V', address: 'MPS Road Multan', phone: '' },
  { name: 'YCDO Executive Hospital-VI', address: 'Dunya Pur City Tehsil Dunya Pur', phone: '' },
  { name: 'YCDO Executive Hospital-VII', address: 'Fazil Pur Tehsil District Dera Ghazi Khan', phone: '' },
];

const kitchenBranches: BranchSeed[] = [
  { name: 'YCDO Rashan Department', address: 'Inside Qasim Pur Colony Multan', phone: '0303-3333214' },
  { name: 'YCDO Kitchen Masoom Shah', address: 'Masoom Shah Road Multan', phone: '0303-3333214' },
  { name: 'YCDO Kitchen Ghanta Ghar', address: 'Chowk Ghanta Ghar Multan', phone: '0303-3333214' },
  { name: 'YCDO Kitchen Qasim Pur', address: 'Inside Qasim Pur Colony Multan', phone: '0303-3333214' },
  { name: 'YCDO Kitchen Ghazi Abad', address: 'Mohalla Ghazi Abad Multan', phone: '0303-3333214' },
  { name: 'YCDO Ramzan Sehar o Aftaar', address: 'Masoom Shah Road Ghanta Ghar and Qasim Pur Colony Multan', phone: '0303-3333214' },
  { name: 'YCDO Water Filtration RO Plant Sabzwari', address: 'Sabzwari Town Multan', phone: '0309-7777514' },
  { name: 'YCDO Water Filtration RO Plant Basti Dogran', address: 'Basti Dogran Multan', phone: '0309-7777514' },
  { name: 'YCDO Water Filtration RO Plant Lodhran', address: 'Chak 389/WB Lodhran', phone: '0309-7777514' },
];

const vtiBranches: BranchSeed[] = [
  { name: 'YCDO VTI For Women Qasim Pur', address: 'Inside Qasim Pur Colony Multan', phone: '0309-2827777' },
  { name: 'YCDO VTI For Women Basti Malook', address: 'Basti Malook Multan', phone: '0309-2827777' },
  { name: 'YCDO VTI Under Development', address: 'Add Laarr Basti Malook Multan', phone: '' },
  { name: 'YCDO Paramedical & Allied Sciences College', address: 'Chowk Ghanta Ghar Multan', phone: '' },
  { name: 'YCDO Jahez Program', address: 'Multan', phone: '0303-3700007' },
  { name: 'YCDO Financial Assistance for Education', address: 'Multan', phone: '0303-3700007' },
];

const hospitalDepartments = [
  'Administration',
  'Human Resources',
  'Medical Staff',
  'Reception',
  'Pharmacy',
  'Laboratory',
  'Housekeeping',
  'Emergency',
];

const seedEmployees = [
  {
    firstName: 'Ahmed',
    lastName: 'Khan',
    email: 'ahmed.khan@ycdo.org',
    cnic: '36302-1234567-1',
    gender: Gender.MALE,
    joiningDate: new Date('2024-01-01'),
    currentDesignation: 'HR Officer',
    departmentName: 'Human Resources',
    basicStipend: 50000,
    employeeCode: 'YCDO-2024-0001',
  },
  {
    firstName: 'Sara',
    lastName: 'Ali',
    email: 'sara.ali@ycdo.org',
    cnic: '36302-7654321-2',
    gender: Gender.FEMALE,
    joiningDate: new Date('2024-03-01'),
    currentDesignation: 'Medical Officer',
    departmentName: 'Medical Staff',
    basicStipend: 80000,
    employeeCode: 'YCDO-2024-0002',
  },
];

type MockEmployeeSeed = {
  firstName: string;
  lastName: string;
  cnic: string;
  gender: Gender;
  phone: string;
  email: string;
  designation: string;
  deptName: string;
  branchName: string;
  shiftPreference?: string;
  basicStipend: number;
  status: EmployeeStatus;
  staffType: StaffType;
  joiningDate: string;
  qualification: {
    degree: string;
    university: string;
    year: number;
    grade: string;
  };
};

const mockEmployees: MockEmployeeSeed[] = [
  {
    firstName: 'Muhammad',
    lastName: 'Usman',
    cnic: '36302-1111111-1',
    gender: Gender.MALE,
    phone: '03001111111',
    email: 'muhammad.usman@ycdo.org',
    designation: 'Medical Officer',
    deptName: 'Medical Staff',
    branchName: 'YCDO Central Hospital',
    shiftPreference: 'Morning Shift',
    basicStipend: 85000,
    status: EmployeeStatus.ACTIVE,
    staffType: StaffType.NEW,
    joiningDate: '2023-01-15',
    qualification: {
      degree: 'MBBS',
      university: 'University of Health Sciences',
      year: 2020,
      grade: 'A Grade',
    },
  },
  {
    firstName: 'Ayesha',
    lastName: 'Malik',
    cnic: '36302-2222222-2',
    gender: Gender.FEMALE,
    phone: '03002222222',
    email: 'ayesha.malik@ycdo.org',
    designation: 'Head Nurse',
    deptName: 'Medical Staff',
    branchName: 'YCDO Central Hospital',
    shiftPreference: 'Evening Shift',
    basicStipend: 55000,
    status: EmployeeStatus.ACTIVE,
    staffType: StaffType.NEW,
    joiningDate: '2023-03-01',
    qualification: {
      degree: 'BSc Nursing',
      university: 'Fatima Jinnah Medical University',
      year: 2019,
      grade: 'B Grade',
    },
  },
  {
    firstName: 'Hassan',
    lastName: 'Raza',
    cnic: '36302-3333333-3',
    gender: Gender.MALE,
    phone: '03003333333',
    email: 'hassan.raza@ycdo.org',
    designation: 'Receptionist',
    deptName: 'Reception',
    branchName: 'YCDO Executive Hospital-I',
    shiftPreference: 'Morning Shift',
    basicStipend: 35000,
    status: EmployeeStatus.ACTIVE,
    staffType: StaffType.EXISTING,
    joiningDate: '2022-06-01',
    qualification: {
      degree: 'BA',
      university: 'BZU Multan',
      year: 2018,
      grade: 'B Grade',
    },
  },
  {
    firstName: 'Fatima',
    lastName: 'Zahra',
    cnic: '36302-4444444-4',
    gender: Gender.FEMALE,
    phone: '03004444444',
    email: 'fatima.zahra@ycdo.org',
    designation: 'Pharmacist',
    deptName: 'Pharmacy',
    branchName: 'YCDO Central Hospital',
    shiftPreference: 'Night Shift',
    basicStipend: 60000,
    status: EmployeeStatus.APPOINTED,
    staffType: StaffType.NEW,
    joiningDate: '2024-01-01',
    qualification: {
      degree: 'PharmD',
      university: 'University of Pharmacy',
      year: 2022,
      grade: 'A Grade',
    },
  },
  {
    firstName: 'Bilal',
    lastName: 'Ahmed',
    cnic: '36302-5555555-5',
    gender: Gender.MALE,
    phone: '03005555555',
    email: 'bilal.ahmed@ycdo.org',
    designation: 'Software Engineer',
    deptName: 'IT Team',
    branchName: 'Software House HQ',
    basicStipend: 75000,
    status: EmployeeStatus.ACTIVE,
    staffType: StaffType.NEW,
    joiningDate: '2023-07-01',
    qualification: {
      degree: 'BSCS',
      university: 'COMSATS University',
      year: 2021,
      grade: 'A Grade',
    },
  },
  {
    firstName: 'Zainab',
    lastName: 'Hussain',
    cnic: '36302-6666666-6',
    gender: Gender.FEMALE,
    phone: '03006666666',
    email: 'zainab.hussain@ycdo.org',
    designation: 'Lab Technician',
    deptName: 'Laboratory',
    branchName: 'Idrees Memorial YCDO Hospital',
    shiftPreference: 'Morning Shift',
    basicStipend: 45000,
    status: EmployeeStatus.ACTIVE,
    staffType: StaffType.NEW,
    joiningDate: '2023-09-15',
    qualification: {
      degree: 'BS Lab Sciences',
      university: 'University of Multan',
      year: 2020,
      grade: 'B Grade',
    },
  },
  {
    firstName: 'Omar',
    lastName: 'Farooq',
    cnic: '36302-7777777-7',
    gender: Gender.MALE,
    phone: '03007777777',
    email: 'omar.farooq@ycdo.org',
    designation: 'Admin Officer',
    deptName: 'Administration',
    branchName: 'YCDO Executive Hospital-II Mother & Child Care',
    basicStipend: 50000,
    status: EmployeeStatus.TRAINEE,
    staffType: StaffType.NEW,
    joiningDate: '2026-01-01',
    qualification: {
      degree: 'BBA',
      university: 'IBA Sukkur',
      year: 2023,
      grade: 'B Grade',
    },
  },
  {
    firstName: 'Sana',
    lastName: 'Tariq',
    cnic: '36302-8888888-8',
    gender: Gender.FEMALE,
    phone: '03008888888',
    email: 'sana.tariq@ycdo.org',
    designation: 'Graphic Designer',
    deptName: 'Social Media',
    branchName: 'Software House HQ',
    basicStipend: 40000,
    status: EmployeeStatus.ACTIVE,
    staffType: StaffType.INTERNEE,
    joiningDate: '2025-06-01',
    qualification: {
      degree: 'BFA',
      university: 'NCA Lahore',
      year: 2024,
      grade: 'A Grade',
    },
  },
  {
    firstName: 'Tariq',
    lastName: 'Mehmood',
    cnic: '36302-9999999-9',
    gender: Gender.MALE,
    phone: '03009999999',
    email: 'tariq.mehmood@ycdo.org',
    designation: 'Housekeeper',
    deptName: 'Housekeeping',
    branchName: 'YCDO Hospital Hassan Abad',
    shiftPreference: 'Morning Shift',
    basicStipend: 25000,
    status: EmployeeStatus.ACTIVE,
    staffType: StaffType.EXISTING,
    joiningDate: '2021-03-01',
    qualification: {
      degree: 'Matric',
      university: 'BISE Multan',
      year: 2015,
      grade: 'C Grade',
    },
  },
  {
    firstName: 'Nadia',
    lastName: 'Iqbal',
    cnic: '36302-0000001-0',
    gender: Gender.FEMALE,
    phone: '03010000001',
    email: 'nadia.iqbal@ycdo.org',
    designation: 'Vocational Trainer',
    deptName: 'Human Resources',
    branchName: 'YCDO VTI For Women Qasim Pur',
    basicStipend: 38000,
    status: EmployeeStatus.APPOINTED,
    staffType: StaffType.NEW,
    joiningDate: '2024-09-01',
    qualification: {
      degree: 'MA Education',
      university: 'BZU Multan',
      year: 2019,
      grade: 'B Grade',
    },
  },
];

async function generateEmployeeCode(prisma: PrismaClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `YCDO-${year}-`;

  const lastEmployee = await prisma.employee.findFirst({
    where: {
      employeeCode: { startsWith: prefix },
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });

  let sequence = 1;
  if (lastEmployee) {
    const lastSequence = parseInt(
      lastEmployee.employeeCode.split('-').pop() ?? '0',
      10,
    );
    sequence = lastSequence + 1;
  }

  return `${prefix}${sequence.toString().padStart(4, '0')}`;
}

async function ensureEmployeePortalUser(
  employeeId: string,
  email: string,
  employeeCode: string,
) {
  await ensureUserAccount(email, employeeCode, UserRole.EMPLOYEE, employeeId);
}

async function ensureBranch(
  name: string,
  address: string,
  phone: string,
  projectId: string,
) {
  let branch = await prisma.branch.findFirst({
    where: { name, address },
  });

  if (!branch) {
    branch = await prisma.branch.findFirst({ where: { name } });
  }

  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        name,
        address,
        phone: phone || null,
        projectId,
      },
    });
  } else {
    branch = await prisma.branch.update({
      where: { id: branch.id },
      data: {
        address,
        phone: phone || branch.phone,
        projectId,
      },
    });
  }

  return branch;
}

async function ensureDepartments(branchId: string, departmentNames: string[]) {
  for (const deptName of departmentNames) {
    const existing = await prisma.department.findFirst({
      where: { name: deptName, branchId },
    });

    if (!existing) {
      await prisma.department.create({
        data: { name: deptName, branchId },
      });
    }
  }
}

async function seedProjectBranches(
  branches: BranchSeed[],
  projectId: string,
  withDepartments: boolean,
) {
  for (const branch of branches) {
    const created = await ensureBranch(
      branch.name,
      branch.address,
      branch.phone,
      projectId,
    );
    if (withDepartments) {
      await ensureDepartments(created.id, hospitalDepartments);
    }
  }
}

const punjabDistricts = [
  'Attock', 'Bahawalnagar', 'Bahawalpur', 'Bhakkar', 'Chakwal',
  'Chiniot', 'Dera Ghazi Khan', 'Faisalabad', 'Gujranwala', 'Gujrat',
  'Hafizabad', 'Jhang', 'Jhelum', 'Kasur', 'Khanewal', 'Khushab',
  'Lahore', 'Layyah', 'Lodhran', 'Mandi Bahauddin', 'Mianwali',
  'Multan', 'Muzaffargarh', 'Nankana Sahib', 'Narowal', 'Okara',
  'Pakpattan', 'Rahim Yar Khan', 'Rawalpindi', 'Sahiwal', 'Sargodha',
  'Sheikhupura', 'Sialkot', 'Toba Tek Singh', 'Vehari',
];

const sindhDistricts = [
  'Badin', 'Dadu', 'Ghotki', 'Hyderabad', 'Jacobabad', 'Jamshoro',
  'Karachi Central', 'Karachi East', 'Karachi Korangi', 'Karachi Malir',
  'Karachi South', 'Karachi West', 'Kashmore', 'Khairpur', 'Larkana',
  'Matiari', 'Mirpur Khas', 'Naushahro Feroze', 'Sanghar', 'Shaheed Benazirabad',
  'Shikarpur', 'Sukkur', 'Tando Allahyar', 'Tando Muhammad Khan', 'Tharparkar',
  'Thatta', 'Umerkot',
];

const kpkDistricts = [
  'Abbottabad', 'Bajaur', 'Bannu', 'Batagram', 'Buner', 'Charsadda',
  'Chitral', 'Dera Ismail Khan', 'Hangu', 'Haripur', 'Karak', 'Khyber',
  'Kohat', 'Kohistan', 'Kurram', 'Lakki Marwat', 'Lower Dir', 'Malakand',
  'Mansehra', 'Mardan', 'Mohmand', 'North Waziristan', 'Nowshera',
  'Orakzai', 'Peshawar', 'Shangla', 'South Waziristan', 'Swabi',
  'Swat', 'Tank', 'Tor Ghar', 'Upper Dir',
];

const balochistanDistricts = [
  'Awaran', 'Barkhan', 'Chagai', 'Dera Bugti', 'Gwadar', 'Harnai',
  'Jaffarabad', 'Jhal Magsi', 'Kalat', 'Kech', 'Kharan', 'Khuzdar',
  'Killa Abdullah', 'Killa Saifullah', 'Kohlu', 'Lasbela', 'Lehri',
  'Loralai', 'Mastung', 'Musakhel', 'Nasirabad', 'Nushki', 'Panjgur',
  'Pishin', 'Quetta', 'Sherani', 'Sibi', 'Sohbatpur', 'Washuk',
  'Zhob', 'Ziarat',
];

async function seedLocationDistricts() {
  const allDistricts = [
    ...punjabDistricts,
    ...sindhDistricts,
    ...kpkDistricts,
    ...balochistanDistricts,
  ];

  for (const district of allDistricts) {
    await prisma.locationValue.upsert({
      where: {
        type_value: { type: 'district', value: district },
      },
      update: {},
      create: { type: 'district', value: district },
    });
  }
}

async function main() {
  await seedLocationDistricts();

  await ensureUserAccount(
    'admin@ycdo.org',
    'Admin@123',
    UserRole.SUPER_ADMIN,
    null,
  );

  await ensureUserAccount(
    'it.team@ycdo.org',
    'ITTeam@123',
    UserRole.IT_ADMIN,
    null,
  );

  const hospital = await prisma.project.upsert({
    where: { id: 'project-hospital' },
    update: {},
    create: {
      id: 'project-hospital',
      name: 'YCDO Hospitals',
      type: ProjectType.HOSPITAL,
    },
  });

  const vti = await prisma.project.upsert({
    where: { id: 'project-vti' },
    update: {},
    create: {
      id: 'project-vti',
      name: 'YCDO VTIs',
      type: ProjectType.VTI,
    },
  });

  const kitchen = await prisma.project.upsert({
    where: { id: 'project-kitchen' },
    update: {},
    create: {
      id: 'project-kitchen',
      name: 'YCDO Kitchens',
      type: ProjectType.KITCHEN,
    },
  });

  const softwareHouse = await prisma.project.upsert({
    where: { id: 'project-software' },
    update: {},
    create: {
      id: 'project-software',
      name: 'YCDO Software House',
      type: ProjectType.SOFTWARE_HOUSE,
    },
  });

  await seedProjectBranches(
    [...hospitalRunningBranches, ...hospitalDevBranches],
    hospital.id,
    true,
  );
  await seedProjectBranches(kitchenBranches, kitchen.id, false);
  await seedProjectBranches(vtiBranches, vti.id, false);

  const swBranch = await prisma.branch.findFirst({
    where: { name: 'Software House HQ' },
  });

  if (!swBranch) {
    await prisma.branch.create({
      data: {
        id: 'branch-software',
        name: 'Software House HQ',
        projectId: softwareHouse.id,
        address: 'YCDO Software House, Multan',
      },
    });
  }

  const softwareBranch =
    swBranch ??
    (await prisma.branch.findFirst({
      where: { name: 'Software House HQ' },
    }));

  if (softwareBranch) {
    await ensureDepartments(softwareBranch.id, [
      'Media House',
      'Social Media',
      'IT Team',
    ]);
  }

  const mainBranch = await prisma.branch.findFirst({
    where: { name: 'YCDO Central Hospital' },
  });

  if (!mainBranch) {
    throw new Error('YCDO Central Hospital not found after seeding');
  }

  for (const emp of seedEmployees) {
    let employee = await prisma.employee.findFirst({
      where: { cnic: emp.cnic },
    });

    if (!employee) {
      const department = await prisma.department.findFirst({
        where: { name: emp.departmentName, branchId: mainBranch.id },
      });

      if (!department) {
        throw new Error(`Department ${emp.departmentName} not found`);
      }

      employee = await prisma.employee.create({
        data: {
          employeeCode: emp.employeeCode,
          firstName: emp.firstName,
          lastName: emp.lastName,
          email: emp.email,
          cnic: emp.cnic,
          gender: emp.gender,
          joiningDate: emp.joiningDate,
          currentDesignation: emp.currentDesignation,
          currentBranchId: mainBranch.id,
          currentDepartmentId: department.id,
        },
      });

      await prisma.employmentHistory.create({
        data: {
          employeeId: employee.id,
          branchId: mainBranch.id,
          departmentId: department.id,
          designation: emp.currentDesignation,
          changeType: ChangeType.JOINED,
          effectiveDate: emp.joiningDate,
        },
      });

      await prisma.stipendRecord.create({
        data: {
          employeeId: employee.id,
          basicStipend: emp.basicStipend,
          effectiveFrom: emp.joiningDate,
        },
      });
    } else if (!employee.email) {
      employee = await prisma.employee.update({
        where: { id: employee.id },
        data: { email: emp.email },
      });
    }

    await ensureEmployeePortalUser(employee.id, emp.email, emp.employeeCode);
  }

  const shifts = [
    { name: 'Morning Shift', startTime: '08:00', endTime: '14:00' },
    { name: 'Evening Shift', startTime: '14:00', endTime: '20:00' },
    { name: 'Night Shift', startTime: '20:00', endTime: '08:00' },
  ];
  for (const shift of shifts) {
    const exists = await prisma.shift.findFirst({
      where: { name: shift.name, branchId: mainBranch.id },
    });
    if (!exists) {
      await prisma.shift.create({
        data: { ...shift, branchId: mainBranch.id },
      });
    }
  }

  const vtiQasimPur = await prisma.branch.findFirst({
    where: { name: { contains: 'YCDO VTI For Women Qasim Pur' } },
  });
  if (vtiQasimPur) {
    await ensureDepartments(vtiQasimPur.id, ['Human Resources', 'Administration']);
  }

  for (const employee of mockEmployees) {
    const existingEmp = await prisma.employee.findFirst({
      where: { cnic: employee.cnic },
    });

    const branch = await prisma.branch.findFirst({
      where: { name: { contains: employee.branchName } },
    });
    if (!branch) {
      console.log(`Branch not found: ${employee.branchName}`);
      continue;
    }

    const dept = await prisma.department.findFirst({
      where: { name: employee.deptName, branchId: branch.id },
    });
    const department =
      dept ??
      (await prisma.department.findFirst({
        where: { name: employee.deptName },
      }));
    if (!department) {
      console.log(`Dept not found: ${employee.deptName}`);
      continue;
    }

    const shift =
      (employee.shiftPreference
        ? await prisma.shift.findFirst({
            where: {
              branchId: branch.id,
              name: { contains: employee.shiftPreference },
            },
          })
        : null) ??
      (await prisma.shift.findFirst({
        where: { branchId: branch.id },
      }));

    const joiningDate = new Date(employee.joiningDate);

    if (!existingEmp) {
      const code = await generateEmployeeCode(prisma);

      const newEmployee = await prisma.employee.create({
        data: {
          employeeCode: code,
          firstName: employee.firstName,
          lastName: employee.lastName,
          cnic: employee.cnic,
          gender: employee.gender,
          phone: employee.phone,
          email: employee.email,
          joiningDate,
          status: employee.status,
          staffType: employee.staffType,
          currentBranchId: branch.id,
          currentDepartmentId: department.id,
          currentDesignation: employee.designation,
          shiftId: shift?.id ?? null,
        },
      });

      await prisma.stipendRecord.create({
        data: {
          employeeId: newEmployee.id,
          basicStipend: employee.basicStipend,
          effectiveFrom: joiningDate,
        },
      });

      await prisma.employmentHistory.create({
        data: {
          employeeId: newEmployee.id,
          branchId: branch.id,
          departmentId: department.id,
          designation: employee.designation,
          changeType: ChangeType.JOINED,
          effectiveDate: joiningDate,
        },
      });

      await prisma.academicQualification.create({
        data: {
          employeeId: newEmployee.id,
          degree: employee.qualification.degree,
          boardUniversity: employee.qualification.university,
          obtainedMarks: employee.qualification.year.toString(),
          divisionGrade: employee.qualification.grade,
        },
      });

      await ensureEmployeePortalUser(newEmployee.id, employee.email, code);

      console.log(
        `Created employee: ${employee.firstName} ${employee.lastName} (${code})`,
      );
    } else {
      const updated = await prisma.employee.update({
        where: { id: existingEmp.id },
        data: {
          firstName: employee.firstName,
          lastName: employee.lastName,
          gender: employee.gender,
          phone: employee.phone,
          email: employee.email,
          joiningDate,
          status: employee.status,
          staffType: employee.staffType,
          currentBranchId: branch.id,
          currentDepartmentId: department.id,
          currentDesignation: employee.designation,
          shiftId: shift?.id ?? null,
        },
      });

      const stipend = await prisma.stipendRecord.findFirst({
        where: { employeeId: updated.id },
      });
      if (!stipend) {
        await prisma.stipendRecord.create({
          data: {
            employeeId: updated.id,
            basicStipend: employee.basicStipend,
            effectiveFrom: joiningDate,
          },
        });
      }

      const joinedHistory = await prisma.employmentHistory.findFirst({
        where: { employeeId: updated.id, changeType: ChangeType.JOINED },
      });
      if (!joinedHistory) {
        await prisma.employmentHistory.create({
          data: {
            employeeId: updated.id,
            branchId: branch.id,
            departmentId: department.id,
            designation: employee.designation,
            changeType: ChangeType.JOINED,
            effectiveDate: joiningDate,
          },
        });
      }

      const qualification = await prisma.academicQualification.findFirst({
        where: { employeeId: updated.id },
      });
      if (!qualification) {
        await prisma.academicQualification.create({
          data: {
            employeeId: updated.id,
            degree: employee.qualification.degree,
            boardUniversity: employee.qualification.university,
            obtainedMarks: employee.qualification.year.toString(),
            divisionGrade: employee.qualification.grade,
          },
        });
      }

      await ensureEmployeePortalUser(
        updated.id,
        employee.email,
        updated.employeeCode,
      );

      if (
        existingEmp.firstName !== employee.firstName ||
        existingEmp.lastName !== employee.lastName
      ) {
        console.log(
          `Updated employee: ${employee.firstName} ${employee.lastName} (${updated.employeeCode})`,
        );
      }
    }
  }

  await prisma.designation.deleteMany({});

  const newDesignations = [
    { title: 'Admin Manager', category: 'Management' },
    { title: 'Pharmacy Staff', category: 'Allied Health' },
    { title: 'Lab Staff', category: 'Allied Health' },
    { title: 'Admin Officer', category: 'Admin' },
    { title: 'Doctor', category: 'Medical' },
    { title: 'Human Resource Staff', category: 'HR' },
    { title: 'Human Resource Manager', category: 'HR' },
    { title: 'Staff Manager', category: 'Management' },
    { title: 'Progress Officer', category: 'Management' },
    { title: 'Accountant/Chief Finance Officer', category: 'Finance' },
    { title: 'Assistant Accountant', category: 'Finance' },
    { title: 'Finance Representative', category: 'Finance' },
    { title: 'Admin Medicine', category: 'Admin' },
    { title: 'Medicine Manager', category: 'Allied Health' },
    { title: 'Medicine Store Manager', category: 'Allied Health' },
    { title: 'Lab Admin Manager', category: 'Allied Health' },
    { title: 'Lab Operation Manager', category: 'Allied Health' },
    { title: 'Lab Store Manager', category: 'Allied Health' },
    { title: 'Audit Officer', category: 'Finance' },
    { title: 'Central Admin Officer', category: 'Admin' },
    { title: 'Coordinator Projects', category: 'Management' },
    { title: 'Surgeon', category: 'Medical' },
    { title: 'Anaesthetics', category: 'Medical' },
    { title: 'OTA', category: 'Medical' },
    { title: 'R&D Coordinator', category: 'IT' },
    { title: 'Biomedical Engineer', category: 'IT' },
    { title: 'Assets Manager', category: 'Admin' },
    { title: 'Kitchen Admin Manager', category: 'Kitchen' },
    { title: 'Kitchen Operation Manager', category: 'Kitchen' },
    { title: 'VTI Admin Officer', category: 'VTI' },
    { title: 'Nurse', category: 'Nursing' },
    { title: 'Head Nurse', category: 'Nursing' },
    { title: 'Receptionist', category: 'Admin' },
    { title: 'Pharmacist', category: 'Allied Health' },
    { title: 'Lab Technician', category: 'Allied Health' },
    { title: 'Housekeeper', category: 'Support' },
    { title: 'Security Guard', category: 'Support' },
    { title: 'Driver', category: 'Support' },
    { title: 'Software Engineer', category: 'IT' },
    { title: 'IT Officer', category: 'IT' },
    { title: 'Social Media Officer', category: 'IT' },
    { title: 'Graphic Designer', category: 'IT' },
    { title: 'Vocational Trainer', category: 'VTI' },
    { title: 'Cashier', category: 'Finance' },
    { title: 'Data Entry Operator', category: 'Admin' },
    { title: 'Cook', category: 'Kitchen' },
  ];

  for (const d of newDesignations) {
    await prisma.designation.upsert({
      where: { title: d.title },
      update: { category: d.category, isActive: true },
      create: d,
    });
  }

  const roleAccounts = [
    { email: 'branch.manager@ycdo.org', password: 'BranchM@123', role: UserRole.BRANCH_MANAGER },
    { email: 'dept.incharge@ycdo.org', password: 'DeptIn@123', role: UserRole.ADMIN_OFFICER },
    { email: 'hr.operations@ycdo.org', password: 'HROps@123', role: UserRole.HR_OPERATIONS_MANAGER },
    { email: 'hr.admin@ycdo.org', password: 'HRAdmin@123', role: UserRole.HR_ADMIN_MANAGER },
    { email: 'chairman@ycdo.org', password: 'Chairman@123', role: UserRole.CHAIRMAN },
    { email: 'founder@ycdo.org', password: 'Founder@123', role: UserRole.FOUNDER },
  ];

  for (const account of roleAccounts) {
    await ensureUserAccount(account.email, account.password, account.role, null);
  }

  const branchLocations = [
    { name: 'YCDO Central Hospital', lat: 30.2014, lng: 71.495, radius: 200 },
    { name: 'YCDO Executive Hospital-I', lat: 30.1956, lng: 71.4753, radius: 200 },
    { name: 'YCDO Executive Hospital-II', lat: 30.182, lng: 71.4689, radius: 200 },
    { name: 'Police & YCDO Drug Rehabilitation Hospital', lat: 30.1734, lng: 71.4801, radius: 200 },
    { name: 'YCDO Executive-V Drug Rehabilitation Hospital', lat: 30.165, lng: 71.4712, radius: 200 },
    { name: 'YCDO Hospital Hassan Abad', lat: 30.2089, lng: 71.4623, radius: 200 },
    { name: 'YCDO Hospital Hassan Parwana', lat: 30.2134, lng: 71.4534, radius: 200 },
    { name: 'YCDO Hospital Suraj Kund', lat: 30.2245, lng: 71.4423, radius: 200 },
    { name: 'Idrees Memorial YCDO Hospital', lat: 30.1912, lng: 71.5023, radius: 200 },
    { name: 'YCDO Hospital Jumma Wala', lat: 30.1456, lng: 71.4834, radius: 200 },
    { name: 'YCDO Hospital Bilawal Pur', lat: 30.3912, lng: 71.8823, radius: 200 },
    { name: 'YCDO Hospital Sikandar Abad', lat: 29.8734, lng: 71.6923, radius: 200 },
    { name: 'YCDO Hospital Pul Dhram Pura', lat: 30.5512, lng: 71.9834, radius: 200 },
    { name: 'Allah Dad Memorial YCDO Hospital', lat: 30.7012, lng: 70.6523, radius: 200 },
    { name: 'YCDO Ghazi National Hospital E-III', lat: 30.0512, lng: 70.6334, radius: 200 },
    { name: 'YCDO AR Executive-IV Hospital', lat: 30.1234, lng: 70.5823, radius: 200 },
    { name: 'YCDO Hospital Budhla Santt', lat: 30.1945, lng: 71.4612, radius: 200 },
    { name: 'YCDO VTI For Women Qasim Pur', lat: 30.1923, lng: 71.5034, radius: 200 },
    { name: 'YCDO VTI For Women Basti Malook', lat: 30.1834, lng: 71.4923, radius: 200 },
    { name: 'YCDO Kitchen Qasim Pur', lat: 30.1912, lng: 71.5023, radius: 200 },
  ];

  for (const loc of branchLocations) {
    const searchTerm = loc.name.split(' ').slice(0, 3).join(' ');
    const branch = await prisma.branch.findFirst({
      where: { name: { contains: searchTerm } },
    });
    if (branch) {
      await prisma.branchLocation.upsert({
        where: { branchId: branch.id },
        update: { latitude: loc.lat, longitude: loc.lng, radius: loc.radius },
        create: {
          branchId: branch.id,
          latitude: loc.lat,
          longitude: loc.lng,
          radius: loc.radius,
        },
      });
    }
  }

  const branchCount = await prisma.branch.count();
  console.log(`Seed completed — ${branchCount} branches total`);
  console.log('\nEmployee portal test accounts (password = employee code):');
  for (const emp of seedEmployees) {
    console.log(`  ${emp.email} / ${emp.employeeCode}`);
  }
  const mockEmpAccounts = await prisma.employee.findMany({
    where: { cnic: { in: mockEmployees.map((e) => e.cnic) } },
    select: { email: true, employeeCode: true },
  });
  for (const emp of mockEmpAccounts) {
    if (emp.email) {
      console.log(`  ${emp.email} / ${emp.employeeCode}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
