import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
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
import { DisciplinaryPage } from '@/pages/disciplinary/DisciplinaryPage'
import { RecruitmentPage } from '@/pages/recruitment/RecruitmentPage'
import { BranchesPage } from '@/pages/branches/BranchesPage'
import { BroadcastsPage } from '@/pages/broadcasts/BroadcastsPage'
import { ProfilePage } from '@/pages/settings/ProfilePage'
import { LoginAccessPage } from '@/pages/admin/LoginAccessPage'
import { MasterDataPage } from '@/pages/admin/MasterDataPage'
import { RolesManagementPage } from '@/pages/admin/RolesManagementPage'
import { UserPasswordsPage } from '@/pages/admin/UserPasswordsPage'
import { SystemLoginsPage } from '@/pages/admin/SystemLoginsPage'
import { ActivityTrailPage } from '@/pages/activity/ActivityTrailPage'
import { ShiftsPage } from '@/pages/shifts/ShiftsPage'
import { RuleBookPage } from '@/pages/rule-book/RuleBookPage'
import { BranchContactsPage } from '@/pages/branch-contacts/BranchContactsPage'
import { BiometricIdsPage } from '@/pages/employees/BiometricIdsPage'

export default function App() {
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
        path="/disciplinary"
        element={
          <ProtectedRoute>
            <DisciplinaryPage />
          </ProtectedRoute>
        }
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
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
