export type FlowStep = {
  title: string
  detail: string
}

export type FlowSection = {
  id: string
  title: string
  summary: string
  where: string
  roles?: string
  steps: FlowStep[]
  links?: { label: string; path: string }[]
  notes?: string[]
}

export type FlowCategory = {
  id: string
  label: string
  sections: FlowSection[]
}

export const ruleBookCategories: FlowCategory[] = [
  {
    id: 'overview',
    label: 'Overview',
    sections: [
      {
        id: 'system-map',
        title: 'How modules connect',
        summary:
          'YCDO HRMS links people, attendance, leave, payroll, and compliance in one chain.',
        where: 'All modules',
        steps: [
          {
            title: 'People',
            detail:
              'Employees are created via Add Employee or Recruitment. New staff need executive approval; existing staff and trainees are active immediately.',
          },
          {
            title: 'Daily operations',
            detail:
              'Attendance (check-in/out, auto checkout at shift end) feeds payroll and disciplinary rules. Leave marks ON_LEAVE on attendance days.',
          },
          {
            title: 'Leave coverage',
            detail:
              'Relievers are assigned during leave application or by HR. Today’s relievers appear on Dashboard and Leave → Today’s Relievers.',
          },
          {
            title: 'Pay & compliance',
            detail:
              'Stipend on employee profile drives payroll. Letters and disciplinary actions attach to the employee record.',
          },
        ],
        links: [
          { label: 'Dashboard', path: '/dashboard' },
          { label: 'Employees', path: '/employees' },
          { label: 'Attendance', path: '/attendance' },
          { label: 'Leave', path: '/leave' },
        ],
        notes: [
          'Employee Portal (separate app) is for staff self-service: apply leave, respond as reliever, portal check-in/out.',
          'HRMS login is for system users only — employee-linked accounts cannot log in here.',
        ],
      },
      {
        id: 'roles',
        title: 'Who sees what',
        summary: 'Sidebar and dashboards change by role.',
        where: 'Sidebar + Dashboard',
        steps: [
          {
            title: 'HR (Manager / Admin / Executive)',
            detail: 'Full employee, attendance, leave, payroll, reports, letters, recruitment.',
          },
          {
            title: 'Branch Manager (ADMIN_MANAGER)',
            detail: 'Branch-scoped dashboard, employees, attendance, leave — first leave approver.',
          },
          {
            title: 'Dept Incharge (ADMIN_OFFICER)',
            detail: 'Department leave approval and reliever assignment.',
          },
          {
            title: 'HR Operations',
            detail: 'Final leave approval, letters, disciplinary.',
          },
          {
            title: 'Executives (President / Founder / Chairman)',
            detail: 'Dashboard, reports, leave view, and new employee onboarding approval.',
          },
          {
            title: 'Medicine Manager',
            detail: 'Medicine department only — attendance mark, view employees (no create/edit).',
          },
          {
            title: 'IT Admin',
            detail: 'Org setup, shifts, login access, broadcasts, activity trail.',
          },
        ],
        links: [{ label: 'Dashboard', path: '/dashboard' }],
      },
    ],
  },
  {
    id: 'employees',
    label: 'Employees',
    sections: [
      {
        id: 'add-employee',
        title: 'Add Employee flow',
        summary: 'Five-step wizard; approval depends on staff type.',
        where: 'Employees → Add Employee',
        roles: 'HR roles with EMPLOYEES_CREATE',
        steps: [
          {
            title: 'Step 0 — Staff type',
            detail:
              'Choose New Staff, Existing Staff, or Trainee / Internee. This controls validation rules and whether approval is required.',
          },
          {
            title: 'Steps 1–4 — Data entry',
            detail:
              'Personal info → Job info (branch, department, designation, shift, duty hours) → Stipend & documents → Qualifications & experience.',
          },
          {
            title: 'New Staff only — Step 5 Approval',
            detail:
              'Upload physical filled form + select executive approver (President, Founder, or Chairman). Employee stays PENDING_APPROVAL until approved.',
          },
          {
            title: 'Existing / Trainee — No approval',
            detail:
              'After step 4, click Create Employee. Status is ACTIVE immediately; login is active; no executive step.',
          },
        ],
        links: [
          { label: 'Add Employee', path: '/employees/new' },
          { label: 'Employee list', path: '/employees' },
        ],
        notes: [
          'Existing staff: relaxed CNIC rules, extra marital/father fields, duty hours required.',
          'Advice/joining letter auto-generation skips EXISTING staff on activation.',
        ],
      },
      {
        id: 'onboarding-approval',
        title: 'Executive onboarding approval',
        summary: 'Only for New Staff with a selected approver.',
        where: 'Executive Dashboard',
        roles: 'PRESIDENT, FOUNDER, CHAIRMAN_ADMIN',
        steps: [
          {
            title: 'HR submits',
            detail:
              'Create request with physical form scan + system form snapshot.',
          },
          {
            title: 'Executive reviews',
            detail:
              'Open pending item → compare Physical form vs System confirmation tabs → Approve or Reject.',
          },
          {
            title: 'On approve',
            detail:
              'Employee becomes ACTIVE, user login enabled, joining/advice letter may generate.',
          },
          {
            title: 'On reject',
            detail: 'Employee remains inactive; HR must correct and resubmit.',
          },
        ],
        links: [{ label: 'Dashboard', path: '/dashboard' }],
      },
      {
        id: 'employee-profile',
        title: 'Employee profile',
        summary: 'Single employee hub for all related records.',
        where: 'Employees → click name',
        steps: [
          {
            title: 'Overview',
            detail: 'Personal, job, stipend summary, status, photo.',
          },
          {
            title: 'Attendance tab',
            detail: 'Monthly attendance history for that employee.',
          },
          {
            title: 'Payroll tab',
            detail: 'Current stipend package and change history.',
          },
          {
            title: 'Documents / Qualifications / Previous employment',
            detail: 'Uploaded files and structured records from onboarding.',
          },
          {
            title: 'Leave / Letters / Disciplinary / Incentives',
            detail: 'Cross-linked records for that person.',
          },
        ],
        links: [{ label: 'Employees', path: '/employees' }],
        notes: [
          'EMPLOYEES_EDIT permission gates personal and job info edits on profile and list.',
        ],
      },
    ],
  },
  {
    id: 'attendance',
    label: 'Attendance',
    sections: [
      {
        id: 'daily-log',
        title: 'Daily Log',
        summary: 'View and edit attendance for any date.',
        where: 'Attendance → Daily Log',
        steps: [
          {
            title: 'Filter',
            detail: 'Pick date, status (Present, Absent, Late, On Leave, etc.), branch/dept/shift filters.',
          },
          {
            title: 'Update',
            detail: 'Change status, check-in/out times, late minutes via Update dialog.',
          },
          {
            title: 'Absent reliever',
            detail:
              'For ABSENT or UNINFORMED_ABSENT rows, use Assign Reliever to mark verified leave for that day and assign coverage.',
          },
        ],
        links: [{ label: 'Attendance', path: '/attendance' }],
      },
      {
        id: 'manual-checkin',
        title: 'Manual Check-In',
        summary: 'HR marks check-in within grace period after duty start.',
        where: 'Attendance → Mark Manual → Check In',
        roles: 'ATTENDANCE_MARK (Medicine Manager: medicine dept only)',
        steps: [
          {
            title: 'Select branch & filters',
            detail: 'Branch managers are locked to their branch; medicine manager to medicine department.',
          },
          {
            title: 'Mark check-in',
            detail:
              'System calculates late minutes from duty start (15 min grace). Status becomes Present, Late, or Half Day.',
          },
        ],
        links: [{ label: 'Manual attendance', path: '/attendance?tab=manual' }],
      },
      {
        id: 'manual-checkout',
        title: 'Manual Check-Out',
        summary: 'Close open check-ins manually.',
        where: 'Attendance → Mark Manual → Check Out',
        steps: [
          {
            title: 'Open sessions',
            detail: 'Lists employees with check-in but no check-out (30-day lookback, optional date filter).',
          },
          {
            title: 'Set checkout time',
            detail:
              'Overnight shifts: checkout datetime moves to next day if needed. Manual checkout always available alongside auto checkout.',
          },
        ],
        links: [{ label: 'Manual checkout', path: '/attendance?tab=manual' }],
      },
      {
        id: 'auto-checkout',
        title: 'Auto checkout at shift end',
        summary: 'Background job — no UI button.',
        where: 'Server (every 15 minutes)',
        steps: [
          {
            title: 'Trigger',
            detail:
              'When current time passes employee duty/shift end, open check-in is closed automatically.',
          },
          {
            title: 'Audit',
            detail: 'Note on log: "Auto-checked out at shift end".',
          },
          {
            title: 'Manual still works',
            detail: 'HR can check out earlier via Manual Check-Out tab.',
          },
        ],
        notes: ['Overnight shifts (e.g. 20:00–08:00) are supported.'],
      },
      {
        id: 'mark-leave-manual',
        title: 'Mark Leave (manual)',
        summary: 'Verified leave — no approval workflow.',
        where: 'Attendance → Mark Manual → Mark Leave',
        roles: 'HR Manager, HR Admin, HR Operations, Super Admin, Admin Manager, Medicine Manager',
        steps: [
          {
            title: 'Set dates & reason',
            detail: 'Regular, short, or emergency leave type.',
          },
          {
            title: 'Optional reliever',
            detail: 'Assign covering employee; creates HR-assigned reliever on approved leave record.',
          },
          {
            title: 'Result',
            detail: 'Leave APPROVED immediately; attendance updated to ON_LEAVE for those dates.',
          },
        ],
        links: [{ label: 'Mark Leave tab', path: '/attendance?tab=manual' }],
      },
      {
        id: 'reliever-sessions',
        title: 'Reliever sessions tab',
        summary: 'Track reliever duty attendance separately.',
        where: 'Attendance → Reliever',
        steps: [
          {
            title: 'View sessions',
            detail: 'Reliever check-in/out and duration for selected date.',
          },
          {
            title: 'Link to leave',
            detail: 'Relievers are assigned from leave flow; this tab shows their session activity.',
          },
        ],
        links: [{ label: 'Reliever tab', path: '/attendance?tab=reliever' }],
      },
      {
        id: 'absent-marking',
        title: 'Auto absent / unmarked',
        summary: 'Scheduled marking at shift start.',
        where: 'Server (background)',
        steps: [
          {
            title: 'Shift start',
            detail: 'Employees without check-in marked UNMARKED at shift start.',
          },
          {
            title: '3 hours later',
            detail: 'Still no check-in → upgraded to UNINFORMED_ABSENT with stipend deduction rules.',
          },
        ],
      },
    ],
  },
  {
    id: 'leave',
    label: 'Leave & Relievers',
    sections: [
      {
        id: 'leave-apply',
        title: 'Apply leave (HRMS)',
        summary: 'HR can apply leave on behalf of employees.',
        where: 'Leave → Apply Leave',
        roles: 'LEAVE_APPLY_OTHERS',
        steps: [
          {
            title: 'Select employee & dates',
            detail: 'Regular, short, or emergency; balance shown for regular leave.',
          },
          {
            title: 'Optional preferred reliever',
            detail:
              'Saved with request; reliever notified after department approval (not at apply time).',
          },
          {
            title: 'Submit',
            detail: 'Enters approval chain — see Leave approval flow.',
          },
        ],
        links: [{ label: 'Leave', path: '/leave' }],
        notes: [
          'Employees use the Employee Portal for self-service leave apply and reliever responses.',
        ],
      },
      {
        id: 'leave-approval',
        title: 'Leave approval chain',
        summary: 'Multi-stage approval before attendance changes.',
        where: 'Leave → Leave Requests',
        steps: [
          {
            title: '1. Branch Manager',
            detail: 'PENDING → Branch approve/reject (ADMIN_MANAGER).',
          },
          {
            title: '2. Dept Incharge',
            detail: 'DEPT stage → Department approve/reject (ADMIN_OFFICER).',
          },
          {
            title: '3. Reliever',
            detail:
              'If preferred reliever was set: notified to accept/decline. If none: dept/HR assigns reliever. HR can assign after rejection.',
          },
          {
            title: '4. HR Operations',
            detail: 'Final approval → APPROVED; attendance marked ON_LEAVE for leave dates.',
          },
          {
            title: 'Emergency leave',
            detail: 'HR can mark emergency leave — fast-tracked processing.',
          },
        ],
        links: [{ label: 'Leave requests', path: '/leave' }],
        notes: [
          'Shift conflict checks between reliever and requester are disabled — any active employee can be assigned.',
        ],
      },
      {
        id: 'reliever-flow',
        title: 'Reliever assignment flows',
        summary: 'Multiple paths to assign coverage.',
        where: 'Leave, Attendance, Dashboard',
        steps: [
          {
            title: 'At apply (preferred)',
            detail: 'Optional reliever on apply → pending request created → notified after dept approval.',
          },
          {
            title: 'Dept / HR assign',
            detail: 'Assign Reliever button on leave list when status allows.',
          },
          {
            title: 'Mark Leave tab',
            detail: 'Verified leave + optional reliever in one step.',
          },
          {
            title: 'Absent employee',
            detail: 'Daily Log → Assign Reliever on absent row → same-day verified leave + reliever.',
          },
          {
            title: 'Today’s relievers',
            detail: 'Leave page button or Dashboard card → list of who is on leave and who is covering.',
          },
        ],
        links: [
          { label: 'Leave', path: '/leave?tab=relievers' },
          { label: 'Dashboard', path: '/dashboard' },
        ],
      },
      {
        id: 'reliever-response',
        title: 'Reliever accept / decline',
        summary: 'Reliever employee action in Portal.',
        where: 'Employee Portal → My Leave → Reliever Requests',
        steps: [
          {
            title: 'Notification',
            detail: 'Reliever gets 8 hours to respond; auto-reject if no response.',
          },
          {
            title: 'Accept',
            detail: 'Leave moves to RELIEVER_CONFIRMED → awaits HR final approval.',
          },
          {
            title: 'Decline',
            detail: 'HR notified to assign another reliever manually.',
          },
        ],
      },
    ],
  },
  {
    id: 'payroll',
    label: 'Payroll & Stipend',
    sections: [
      {
        id: 'stipend',
        title: 'Stipend package',
        summary: 'Set at employee create; visible on profile.',
        where: 'Add Employee step 3 + Employee profile → Payroll',
        steps: [
          {
            title: 'Components',
            detail: 'Basic stipend, allowances, rewards, fuel, deductions (loan, advance, fine, health).',
          },
          {
            title: 'History',
            detail: 'Stipend changes tracked with effective dates.',
          },
        ],
        links: [{ label: 'Payroll', path: '/payroll' }],
      },
      {
        id: 'monthly-payroll',
        title: 'Monthly payroll processing',
        summary: 'Run payroll using attendance and stipend data.',
        where: 'Payroll → Monthly Payroll',
        roles: 'PAYROLL_MANAGE',
        steps: [
          {
            title: 'Select month',
            detail: 'Pulls attendance summaries, leave, disciplinary deductions.',
          },
          {
            title: 'Process',
            detail: 'Generate payroll records per employee.',
          },
        ],
        links: [{ label: 'Payroll', path: '/payroll' }],
      },
    ],
  },
  {
    id: 'other',
    label: 'Other modules',
    sections: [
      {
        id: 'recruitment',
        title: 'Recruitment',
        summary: 'Hire pipeline before employee record exists.',
        where: 'Recruitment',
        steps: [
          {
            title: 'Applications',
            detail: 'APPLIED → SHORTLISTED → INTERVIEW → SELECTED / REJECTED.',
          },
          {
            title: 'Accept as trainee',
            detail: 'Creates TRAINEE employee status (recruitment path, not Add Employee wizard).',
          },
          {
            title: 'Convert to employee',
            detail: 'Prefill Add Employee form for full onboarding.',
          },
        ],
        links: [{ label: 'Recruitment', path: '/recruitment' }],
      },
      {
        id: 'letters',
        title: 'Letters',
        summary: 'Generated PDFs linked to employees.',
        where: 'Letters + Employee profile',
        roles: 'LETTERS_GENERATE',
        steps: [
          {
            title: 'Types',
            detail: 'Appointment, warning, transfer, experience, increment, and more.',
          },
          {
            title: 'Generate',
            detail: 'From letters page or employee list/profile dialog.',
          },
        ],
        links: [{ label: 'Letters', path: '/letters' }],
      },
      {
        id: 'disciplinary',
        title: 'Disciplinary',
        summary: 'Actions tied to attendance and conduct.',
        where: 'Disciplinary',
        roles: 'DISCIPLINARY_MANAGE',
        steps: [
          {
            title: 'Actions',
            detail: 'Warning, show cause, fine, suspension, termination.',
          },
          {
            title: 'Inquiries',
            detail: 'Follow-up workflow from an action.',
          },
          {
            title: 'Auto rules',
            detail: 'Half day / uninformed absent can trigger stipend deductions via discipline helper.',
          },
        ],
        links: [{ label: 'Disciplinary', path: '/disciplinary' }],
      },
      {
        id: 'branch-change',
        title: 'Branch change request',
        summary: 'Temporary assignment to another branch.',
        where: 'Branch Change Request',
        steps: [
          {
            title: 'Create request',
            detail: 'Employee, target branch, dates, reason.',
          },
          {
            title: 'Approve / complete',
            detail: 'PENDING → APPROVED → COMPLETED when assignment ends.',
          },
        ],
        links: [{ label: 'Branch Change', path: '/branch-change-request' }],
      },
      {
        id: 'reports',
        title: 'Reports',
        summary: 'Exportable CSV reports with filters.',
        where: 'Reports',
        roles: 'REPORTS_VIEW',
        steps: [
          {
            title: 'Categories',
            detail: 'Employee master, attendance, leave, branch change, district/branch/dept summaries.',
          },
        ],
        links: [{ label: 'Reports', path: '/reports' }],
      },
      {
        id: 'permissions',
        title: 'Permissions & logins',
        summary: 'Fine-grained access beyond role defaults.',
        where: 'Login Access, Roles & Access',
        roles: 'IT_ADMIN, SUPER_ADMIN',
        steps: [
          {
            title: 'Role defaults',
            detail: 'Each role has baseline permissions (see permissionDefaults).',
          },
          {
            title: 'Overrides',
            detail: 'Login Access can grant or deny per user (e.g. EMPLOYEES_EDIT, ATTENDANCE_MARK).',
          },
          {
            title: 'Re-login',
            detail: 'Permission changes apply after user logs in again (JWT refresh).',
          },
        ],
        links: [
          { label: 'Login Access', path: '/admin/login-access' },
          { label: 'Roles & Access', path: '/admin/roles' },
        ],
      },
      {
        id: 'medicine-manager',
        title: 'Medicine Manager scope',
        summary: 'Restricted role for medicine department.',
        where: 'Dashboard, Employees, Attendance',
        steps: [
          {
            title: 'Scope',
            detail: 'Only Medicine Management System department employees.',
          },
          {
            title: 'Can do',
            detail: 'View employees, mark attendance (manual tabs).',
          },
          {
            title: 'Cannot do',
            detail: 'Create/edit employees, generate letters, change status.',
          },
        ],
        links: [{ label: 'Attendance', path: '/attendance?tab=manual' }],
      },
    ],
  },
]

export const masterFlowMermaid = `flowchart TB
  subgraph hire [Hiring]
    REC[Recruitment] --> ADD[Add Employee]
    ADD -->|New Staff| APP[Executive Approval]
    ADD -->|Existing / Trainee| ACT[Active Employee]
    APP --> ACT
  end

  subgraph daily [Daily ops]
    ACT --> ATT[Attendance]
    ATT -->|Check-in/out| LOG[Daily Log]
    ATT -->|Shift end| AUTO[Auto Checkout]
    ATT -->|Manual| ML[Mark Leave + Reliever]
  end

  subgraph leaveFlow [Leave]
    ACT --> LV[Leave Request]
    LV --> BM[Branch Approve]
    BM --> DI[Dept Approve]
    DI --> RL[Reliever Assign/Accept]
    RL --> HR[HR Operations Approve]
    HR --> ONL[ON_LEAVE on Attendance]
    RL --> TR[Today's Relievers / Dashboard]
  end

  subgraph pay [Pay & compliance]
    ACT --> STIP[Stipend]
    LOG --> PAY[Monthly Payroll]
    STIP --> PAY
    ACT --> LET[Letters]
    ACT --> DIS[Disciplinary]
  end`
