import { Routes, Route, Navigate } from "react-router-dom"
import { useAuth } from "./context/AuthContext"
import Login from "./pages/Login"
import Signup from "./pages/Signup"
import Dashboard from "./pages/agent/Dashboard"
import Clients from "./pages/agent/Clients"
import ClientDetail from "./pages/agent/ClientDetail"
import Suppliers from "./pages/agent/Suppliers"
import SupplierDetail from "./pages/agent/SupplierDetail"
import Tickets from "./pages/agent/Tickets"
import Payments from "./pages/agent/Payments"
import Settings from "./pages/agent/Settings"
import AdminAgents from "./pages/admin/Agents"
import AdminSettings from "./pages/admin/AdminSettings"
import ClientLedger from "./pages/agent/reports/ClientLedger"
import SupplierLedger from "./pages/agent/reports/SupplierLedger"
import ChannelLedger from "./pages/agent/reports/ChannelLedger"

function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  return user ? children : <Navigate to="/login" replace />
}

function AdminRoute({ children }) {
  const { user, agent, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return agent?.is_admin ? children : <Navigate to="/dashboard" replace />
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  return user ? <Navigate to="/dashboard" replace /> : children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/signup" element={<PublicRoute><Signup /></PublicRoute>} />
      <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
      <Route path="/clients" element={<PrivateRoute><Clients /></PrivateRoute>} />
      <Route path="/clients/:id" element={<PrivateRoute><ClientDetail /></PrivateRoute>} />
      <Route path="/suppliers" element={<PrivateRoute><Suppliers /></PrivateRoute>} />
      <Route path="/suppliers/:id" element={<PrivateRoute><SupplierDetail /></PrivateRoute>} />
      <Route path="/tickets" element={<PrivateRoute><Tickets /></PrivateRoute>} />
      <Route path="/payments" element={<PrivateRoute><Payments /></PrivateRoute>} />
      <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
      <Route path="/reports/client-ledger" element={<PrivateRoute><ClientLedger /></PrivateRoute>} />
      <Route path="/reports/supplier-ledger" element={<PrivateRoute><SupplierLedger /></PrivateRoute>} />
      <Route path="/reports/channel-ledger" element={<PrivateRoute><ChannelLedger /></PrivateRoute>} />
      <Route path="/admin/agents" element={<AdminRoute><AdminAgents /></AdminRoute>} />
      <Route path="/admin/settings" element={<AdminRoute><AdminSettings /></AdminRoute>} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
