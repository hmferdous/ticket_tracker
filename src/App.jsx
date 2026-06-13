import { Routes, Route, Navigate } from "react-router-dom"
import { useAuth } from "./context/AuthContext"
import Login from "./pages/Login"
import Signup from "./pages/Signup"
import Dashboard from "./pages/agent/Dashboard"
import Clients from "./pages/agent/Clients"
import ClientDetail from "./pages/agent/ClientDetail"
import Suppliers from "./pages/agent/Suppliers"
import Tickets from "./pages/agent/Tickets"
import Payments from "./pages/agent/Payments"
import Settings from "./pages/agent/Settings"

function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  return user ? children : <Navigate to="/login" replace />
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
      <Route path="/tickets" element={<PrivateRoute><Tickets /></PrivateRoute>} />
      <Route path="/payments" element={<PrivateRoute><Payments /></PrivateRoute>} />
      <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
