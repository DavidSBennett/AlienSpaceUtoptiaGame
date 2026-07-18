import { Routes, Route } from 'react-router-dom';

import Home from './pages/Home.jsx';
import Game from './pages/Game.jsx';
import LeaderboardPage from './pages/LeaderboardPage.jsx';
import WorksPage from './pages/WorksPage.jsx';
import PlaytestReportPage from './pages/PlaytestReportPage.jsx';
import AdminPlaytestPage from './pages/AdminPlaytestPage.jsx';
import DeckListPage from './pages/DeckListPage.jsx';

// Multiplayer pages — the lobby ENTRY was merged into Home; /multiplayer
// now lands on Home with the MP panel pre-expanded. Sub-routes
// (waiting room for a specific lobby, the game itself, results) live
// in their own components and are RequireAuth-wrapped here.
import MultiplayerWaitingRoom from './pages/MultiplayerWaitingRoom.jsx';
import MultiplayerGame from './pages/MultiplayerGame.jsx';
import MultiplayerResults from './pages/MultiplayerResults.jsx';

// Auth pages — public and gated
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import VerifyEmailPage from './pages/VerifyEmailPage.jsx';
import AccountPage from './pages/AccountPage.jsx';
import AdminInvitesPage from './pages/AdminInvitesPage.jsx';
import AdminDecksPage from './pages/AdminDecksPage.jsx';
import AdminGamesPage from './pages/AdminGamesPage.jsx';
import RequireAuth from './auth/RequireAuth.jsx';

import DesktopOnlyGate from './components/DesktopOnlyGate.jsx';

export default function App() {
  return (
    <Routes>
      {/* Landing page is publicly accessible — signed-out visitors see
          the gilt frame with a sign-in / create-account CTA where the
          play buttons would be; signed-in users see the deck picker,
          solo button, multiplayer toggle, and (if applicable) the
          Your Games widget. */}
      <Route path="/" element={<Home />} />

      {/* Card Library — signed-in. /cards is kept as an alias of /decks. */}
      <Route path="/decks" element={<RequireAuth><DeckListPage /></RequireAuth>} />

      {/* All gameplay surfaces require login. RequireAuth nests inside
          DesktopOnlyGate (gate first, then auth) so mobile visitors
          see the friendly desktop notice rather than a login form. */}
      <Route path="/game" element={
        <DesktopOnlyGate><RequireAuth><Game /></RequireAuth></DesktopOnlyGate>
      } />
      {/* Open to everyone — the guided walkthrough needs no login (its own
          deck, no score saved). Desktop-only, but not auth-gated. */}
      <Route path="/tutorial" element={
        <DesktopOnlyGate><Game tutorial /></DesktopOnlyGate>
      } />
      <Route path="/leaderboard" element={
        <RequireAuth><LeaderboardPage /></RequireAuth>
      } />
      <Route path="/cards" element={
        <RequireAuth><DeckListPage /></RequireAuth>
      } />
      <Route path="/works" element={
        <RequireAuth><WorksPage /></RequireAuth>
      } />
      <Route path="/playtest-report" element={
        <RequireAuth><PlaytestReportPage /></RequireAuth>
      } />

      {/* /multiplayer is now an alias to Home with the MP panel open.
          Bookmarked old URLs keep working; the page itself is public
          (Home handles the signed-out CTA). */}
      <Route path="/multiplayer" element={<Home />} />
      <Route path="/multiplayer/lobby/:gameId" element={
        <RequireAuth><MultiplayerWaitingRoom /></RequireAuth>
      } />
      <Route path="/multiplayer/game/:gameId" element={
        <DesktopOnlyGate><RequireAuth><MultiplayerGame /></RequireAuth></DesktopOnlyGate>
      } />
      <Route path="/multiplayer/end/:gameId" element={
        <RequireAuth><MultiplayerResults /></RequireAuth>
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

      {/* Admin routes — admin flag required (handled inside RequireAuth) */}
      <Route path="/admin/invites" element={
        <RequireAuth admin><AdminInvitesPage /></RequireAuth>
      } />
      <Route path="/admin/decks" element={
        <RequireAuth admin><AdminDecksPage /></RequireAuth>
      } />
      <Route path="/admin/games" element={
        <RequireAuth admin><AdminGamesPage /></RequireAuth>
      } />
      <Route path="/admin/playtest" element={
        <RequireAuth admin><AdminPlaytestPage /></RequireAuth>
      } />
    </Routes>
  );
}
