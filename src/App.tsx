import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider } from './lib/store'
import { ToastProvider } from './ui/Toast'
import Admin from './pages/Admin'
import AppShell from './pages/AppShell'
import Billing from './pages/Billing'
import Console from './pages/Console'
import Guests from './pages/Guests'
import Home from './pages/Home'
import Landing from './pages/Landing'
import Login from './pages/Login'
import MapPage from './pages/MapPage'
import Patrol from './pages/Patrol'
import Pending from './pages/Pending'
import Register from './pages/Register'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import Support from './pages/Support'

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <HashRouter>
          <Routes>
            <Route
              path="/"
              element={
                <div className="shell">
                  <Landing />
                </div>
              }
            />
            <Route path="/register" element={<Register />} />
            <Route path="/login" element={<Login />} />
            <Route
              path="/pending"
              element={<Pending />}
            />
            <Route path="/console" element={<Console />} />
            <Route path="/app" element={<AppShell />}>
              <Route index element={<Home />} />
              <Route path="reports" element={<Reports />} />
              <Route path="map" element={<MapPage />} />
              <Route path="guests" element={<Guests />} />
              <Route path="patrol" element={<Patrol />} />
              <Route path="admin" element={<Admin />} />
              <Route path="settings" element={<Settings />} />
              <Route path="billing" element={<Billing />} />
              <Route path="support" element={<Support />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </HashRouter>
      </ToastProvider>
    </AppProvider>
  )
}
