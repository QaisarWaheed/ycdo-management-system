import { useEffect, useRef } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import JobsPublicPage from '@/pages/careers/JobsPublicPage'
import JobDetailPublicPage from '@/pages/careers/JobDetailPublicPage'
import ApplicantAuthPage from '@/pages/careers/ApplicantAuthPage'
import MyApplicationsPage from '@/pages/careers/MyApplicationsPage'
import HRCareersPage from '@/pages/careers/HRCareersPage'
import HRApplicationsPage from '@/pages/careers/HRApplicationsPage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { DashboardPage } from '@/pages/dashboard/DashboardPage'
import {
  EmployeeCreatePage,
  EmployeeProfilePage,
  EmployeesListPage,
} from '@/pages/employees'
import { AttendancePage } from '@/pages/attendance/AttendancePage'
import { LeavePage } from '@/pages/leave/LeavePage'
import { BranchChangeRequestPage } from '@/pages/branch-change-request/BranchChangeRequestPage'
import { IncentivesPage } from '@/pages/incentives/IncentivesPage'
import { PayrollPage } from '@/pages/payroll/PayrollPage'
import { ReportsPage } from '@/pages/reports/ReportsPage'
import { LettersPage } from '@/pages/letters/LettersPage'
import { RecruitmentPage } from '@/pages/recruitment/RecruitmentPage'
import { BranchesPage } from '@/pages/branches/BranchesPage'
import { BroadcastsPage } from '@/pages/broadcasts/BroadcastsPage'
import { ProfilePage } from '@/pages/settings/ProfilePage'
import { LoginAccessPage } from '@/pages/admin/LoginAccessPage'
import { PendingApprovalsPage } from '@/pages/admin/PendingApprovalsPage'
import { PayApprovalsPage } from '@/pages/payroll/PayApprovalsPage'
import { PayrollWorkflowPage } from '@/pages/payroll/PayrollWorkflowPage'
import { SalarySetupStatusPage } from '@/pages/payroll/SalarySetupStatusPage'
import { MedicinePendingPage } from '@/pages/payroll/MedicinePendingPage'
import { ExtraTimeApprovalsPage } from '@/pages/attendance/ExtraTimeApprovalsPage'
import { SpecialLeavesPage } from '@/pages/leave/SpecialLeavesPage'
import { IncentiveManagementPage } from '@/pages/incentives/IncentiveManagementPage'
import { TeamAssignmentsPage } from '@/pages/admin/TeamAssignmentsPage'
import { MyTeamPage } from '@/pages/team/MyTeamPage'
import { FineAuditPage } from '@/pages/letters/FineAuditPage'
import { PunchReviewsPage } from '@/pages/attendance/PunchReviewsPage'
import { DoctorPerformancePage } from '@/pages/payroll/DoctorPerformancePage'
import { MasterDataPage } from '@/pages/admin/MasterDataPage'
import { LetterTemplatesPage } from '@/pages/admin/LetterTemplatesPage'
import { AppointmentLetterSettingsPage } from '@/pages/admin/AppointmentLetterSettingsPage'
import { LetterTemplateEditorPage } from '@/pages/admin/LetterTemplateEditorPage'
import { RolesManagementPage } from '@/pages/admin/RolesManagementPage'
import { UserPasswordsPage } from '@/pages/admin/UserPasswordsPage'
import { SystemLoginsPage } from '@/pages/admin/SystemLoginsPage'
import { ActivityTrailPage } from '@/pages/activity/ActivityTrailPage'
import { ShiftsPage } from '@/pages/shifts/ShiftsPage'
import { RuleBookPage } from '@/pages/rule-book/RuleBookPage'
import { BranchContactsPage } from '@/pages/branch-contacts/BranchContactsPage'
import { BiometricIdsPage } from '@/pages/employees/BiometricIdsPage'
import { PortalLoginStatusPage } from '@/pages/portal/PortalLoginStatusPage'

export default function App() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const previousUserId = useRef<string | null>(user?.id ?? null)
  useEffect(() => {
    const nextUserId = user?.id ?? null
    if (previousUserId.current !== nextUserId) queryClient.clear()
    previousUserId.current = nextUserId
  }, [queryClient, user?.id])

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/portal-login"
        element={
          <ProtectedRoute>
            <PortalLoginStatusPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/employees"
        element={
          <ProtectedRoute>
            <EmployeesListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/biometric-ids"
        element={
          <ProtectedRoute>
            <BiometricIdsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/employees/new"
        element={
          <ProtectedRoute>
            <EmployeeCreatePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/employees/:id"
        element={
          <ProtectedRoute>
            <EmployeeProfilePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/attendance"
        element={
          <ProtectedRoute>
            <AttendancePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/leave"
        element={
          <ProtectedRoute>
            <LeavePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/branch-change-request"
        element={
          <ProtectedRoute>
            <BranchChangeRequestPage />
          </ProtectedRoute>
        }
      />
      <Route path="/outstation" element={<Navigate to="/branch-change-request" replace />} />
      <Route
        path="/incentives"
        element={
          <ProtectedRoute>
            <IncentivesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/payroll"
        element={
          <ProtectedRoute>
            <PayrollPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <ReportsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/letters"
        element={
          <ProtectedRoute>
            <LettersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/failed-whatsapp"
        element={<Navigate to="/letters?section=failed-whatsapp" replace />}
      />
      <Route
        path="/disciplinary"
        element={<Navigate to="/letters?section=disciplinary" replace />}
      />
      <Route
        path="/disciplinary/suspension-watchlist"
        element={<Navigate to="/letters?section=watchlist" replace />}
      />
      <Route
        path="/recruitment"
        element={
          <ProtectedRoute>
            <RecruitmentPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/broadcasts"
        element={
          <ProtectedRoute>
            <BroadcastsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/branches"
        element={
          <ProtectedRoute>
            <BranchesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/branch-contacts"
        element={
          <ProtectedRoute>
            <BranchContactsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/profile"
        element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/rule-book"
        element={
          <ProtectedRoute>
            <RuleBookPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/shifts"
        element={
          <ProtectedRoute>
            <ShiftsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/activity-trail"
        element={
          <ProtectedRoute>
            <ActivityTrailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/login-access"
        element={
          <ProtectedRoute>
            <LoginAccessPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/pending-approvals"
        element={
          <ProtectedRoute>
            <PendingApprovalsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/pay-approvals"
        element={
          <ProtectedRoute>
            <PayApprovalsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/medicine-pending"
        element={
          <ProtectedRoute>
            <MedicinePendingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/salary-setup-status"
        element={
          <ProtectedRoute>
            <SalarySetupStatusPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/payroll-workflow"
        element={
          <ProtectedRoute>
            <PayrollWorkflowPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/fine-audit"
        element={
          <ProtectedRoute>
            <FineAuditPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/team-assignments"
        element={
          <ProtectedRoute>
            <TeamAssignmentsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-team"
        element={
          <ProtectedRoute>
            <MyTeamPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/incentive-management"
        element={
          <ProtectedRoute>
            <IncentiveManagementPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/special-leaves"
        element={
          <ProtectedRoute>
            <SpecialLeavesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/extra-time-approvals"
        element={
          <ProtectedRoute>
            <ExtraTimeApprovalsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/punch-reviews"
        element={
          <ProtectedRoute>
            <PunchReviewsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/doctor-performance"
        element={
          <ProtectedRoute>
            <DoctorPerformancePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/roles"
        element={
          <ProtectedRoute>
            <RolesManagementPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/master-data"
        element={
          <ProtectedRoute>
            <MasterDataPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/letter-templates"
        element={
          <ProtectedRoute>
            <LetterTemplatesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/appointment-letter-settings"
        element={
          <ProtectedRoute>
            <AppointmentLetterSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/letter-templates/new"
        element={
          <ProtectedRoute>
            <LetterTemplateEditorPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/letter-templates/:code/edit"
        element={
          <ProtectedRoute>
            <LetterTemplateEditorPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/employee-passwords"
        element={
          <ProtectedRoute>
            <UserPasswordsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/system-logins"
        element={
          <ProtectedRoute>
            <SystemLoginsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/user-passwords"
        element={<Navigate to="/admin/employee-passwords" replace />}
      />
      {/* ── Public Careers pages (no ProtectedRoute) ── */}
      <Route path="/jobs" element={<JobsPublicPage />} />
      <Route path="/jobs/auth" element={<ApplicantAuthPage />} />
      <Route path="/jobs/my-applications" element={<MyApplicationsPage />} />
      <Route path="/jobs/:id" element={<JobDetailPublicPage />} />

      {/* ── HR Careers admin (ProtectedRoute) ── */}
      <Route
        path="/careers"
        element={
          <ProtectedRoute>
            <HRCareersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/careers/applications"
        element={
          <ProtectedRoute>
            <HRApplicationsPage />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
