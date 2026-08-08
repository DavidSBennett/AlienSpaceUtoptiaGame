import { Routes, Route, Navigate } from 'react-router-dom';

// THE ICC — this build is a standalone game. The Historians pages that
// used to live here are unrouted (their files remain in the repo, unused);
// only the shared account system (invite-gated registration, sessions)
// carries over.
import SpaceLobby from './pages/SpaceLobby.jsx';
import SpaceGame from './pages/SpaceGame.jsx';

// Auth pages — public and gated
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import VerifyEmailPage from './pages/VerifyEmailPage.jsx';
import AccountPage from './pages/AccountPage.jsx';
import AdminInvitesPage from './pages/AdminInvitesPage.jsx';
import RequireAuth from './auth/RequireAuth.jsx';

import DesktopOnlyGate from './components/DesktopOnlyGate.jsx';

export default function App() {
  return (
    <Routes>
      {/* The ICC lobby IS the landing page. */}
      <Route path="/" element={<RequireAuth><SpaceLobby /></RequireAuth>} />
      {/* Legacy alias kept so old bookmarks and in-app links still work. */}
      <Route path="/space" element={<Navigate to="/" replace />} />
      <Route path="/space/game/:gameId" element={
        <DesktopOnlyGate><RequireAuth><SpaceGame /></RequireAuth></DesktopOnlyGate>
      } />

      {/* Auth routes — public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />

      {/* Auth routes — signed-in only */}
      <Route path="/account" element={
        <RequireAuth><AccountPage /></RequireAuth>
      } />

      {/* Admin — invite codes gate registration */}
      <Route path="/admin/invites" element={
        <RequireAuth admin><AdminInvitesPage /></RequireAuth>
      } />

      {/* Anything else → the lobby */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
