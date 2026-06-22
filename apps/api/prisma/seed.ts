import {
  ChangeType,
  Gender,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const branches = [
  {
    name: 'YCDO Central Hospital - Main Branch',
    address: 'Main Branch Address, Multan',
    phone: '061-1234567',
  },
  {
    name: 'YCDO Central Hospital - North Branch',
    address: 'North Branch Address, Multan',
    phone: '061-7654321',
  },
];

const departmentNames = [
  'Human Resources',
  'Medical Staff',
  'Administration',
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
    basicSalary: 50000,
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
    basicSalary: 80000,
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

  const branchMap = new Map<string, string>();

  for (const branchData of branches) {
    let branch = await prisma.branch.findFirst({
      where: { name: branchData.name },
    });

    if (!branch) {
      branch = await prisma.branch.create({ data: branchData });
    }

    branchMap.set(branchData.name, branch.id);

    for (const deptName of departmentNames) {
      const existing = await prisma.department.findFirst({
        where: { name: deptName, branchId: branch.id },
      });

      if (!existing) {
        await prisma.department.create({
          data: { name: deptName, branchId: branch.id },
        });
      }
    }
  }

  const mainBranchId = branchMap.get('YCDO Central Hospital - Main Branch');
  if (!mainBranchId) {
    throw new Error('Main Branch not found after seeding');
  }

  for (const emp of seedEmployees) {
    let employee = await prisma.employee.findFirst({
      where: { cnic: emp.cnic },
    });

    if (!employee) {
      const department = await prisma.department.findFirst({
        where: { name: emp.departmentName, branchId: mainBranchId },
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
          currentBranchId: mainBranchId,
          currentDepartmentId: department.id,
        },
      });

      await prisma.employmentHistory.create({
        data: {
          employeeId: employee.id,
          branchId: mainBranchId,
          departmentId: department.id,
          designation: emp.currentDesignation,
          changeType: ChangeType.JOINED,
          effectiveDate: emp.joiningDate,
        },
      });

      await prisma.salaryRecord.create({
        data: {
          employeeId: employee.id,
          basicSalary: emp.basicSalary,
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

  const hospital = await prisma.project.upsert({
    where: { id: 'project-hospital' },
    update: {},
    create: {
      id: 'project-hospital',
      name: 'YCDO Hospitals',
      type: 'HOSPITAL',
    },
  });

  const vti = await prisma.project.upsert({
    where: { id: 'project-vti' },
    update: {},
    create: {
      id: 'project-vti',
      name: 'YCDO VTIs',
      type: 'VTI',
    },
  });

  const kitchen = await prisma.project.upsert({
    where: { id: 'project-kitchen' },
    update: {},
    create: {
      id: 'project-kitchen',
      name: 'YCDO Kitchens',
      type: 'KITCHEN',
    },
  });

  const softwareHouse = await prisma.project.upsert({
    where: { id: 'project-software' },
    update: {},
    create: {
      id: 'project-software',
      name: 'YCDO Software House',
      type: 'SOFTWARE_HOUSE',
    },
  });

  await prisma.branch.updateMany({
    where: { projectId: null },
    data: { projectId: hospital.id },
  });

  const swBranch = await prisma.branch.upsert({
    where: { id: 'branch-software' },
    update: {},
    create: {
      id: 'branch-software',
      name: 'Software House HQ',
      projectId: softwareHouse.id,
      address: 'YCDO Software House, Multan',
    },
  });

  const swDepts = ['Media House', 'Social Media', 'IT Team'];
  for (const deptName of swDepts) {
    const exists = await prisma.department.findFirst({
      where: { name: deptName, branchId: swBranch.id },
    });
    if (!exists) {
      await prisma.department.create({
        data: { name: deptName, branchId: swBranch.id },
      });
    }
  }

  const mainBranch = await prisma.branch.findFirst({
    where: { name: { contains: 'Main' } },
  });

  if (mainBranch) {
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
  }

  console.log('Seed completed');
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
