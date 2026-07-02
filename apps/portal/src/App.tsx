import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { LoginPage } from '@/pages/auth/LoginPage'
import { DashboardPage } from '@/pages/dashboard/DashboardPage'
import { MyAttendancePage } from '@/pages/attendance/MyAttendancePage'
import { MyLeavePage } from '@/pages/leave/MyLeavePage'
import { MyPayrollPage } from '@/pages/payroll/MyPayrollPage'
import { MyLettersPage } from '@/pages/letters/MyLettersPage'
import { MyBranchChangeRequestPage } from '@/pages/branch-change-request/MyBranchChangeRequestPage'
import { AdvanceLoanPage } from '@/pages/advance-loan/AdvanceLoanPage'
import { MyProfilePage } from '@/pages/profile/MyProfilePage'

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
        path="/attendance"
        element={
          <ProtectedRoute>
            <MyAttendancePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/leave"
        element={
          <ProtectedRoute>
            <MyLeavePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/payroll"
        element={
          <ProtectedRoute>
            <MyPayrollPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/letters"
        element={
          <ProtectedRoute>
            <MyLettersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/branch-change-request"
        element={
          <ProtectedRoute>
            <MyBranchChangeRequestPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/outstation"
        element={<Navigate to="/branch-change-request" replace />}
      />
      <Route
        path="/advance-loan"
        element={
          <ProtectedRoute>
            <AdvanceLoanPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <MyProfilePage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
