import {
  ChangeType,
  Gender,
  PrismaClient,
  ProjectType,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

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

async function ensureEmployeePortalUser(
  employeeId: string,
  email: string,
  employeeCode: string,
) {
  const password = await bcrypt.hash(employeeCode, 10);

  await prisma.user.upsert({
    where: { email },
    update: {
      employeeId,
      password,
      role: UserRole.EMPLOYEE,
      isActive: true,
    },
    create: {
      email,
      password,
      role: UserRole.EMPLOYEE,
      employeeId,
      isActive: true,
    },
  });
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

async function main() {
  const hashedPassword = await bcrypt.hash('Admin@123', 10);

  await prisma.user.upsert({
    where: { email: 'admin@ycdo.org' },
    update: {},
    create: {
      email: 'admin@ycdo.org',
      password: hashedPassword,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
    },
  });

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

  const branchCount = await prisma.branch.count();
  console.log(`Seed completed — ${branchCount} branches total`);
  console.log('\nEmployee portal test accounts (password = employee code):');
  for (const emp of seedEmployees) {
    console.log(`  ${emp.email} / ${emp.employeeCode}`);
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
