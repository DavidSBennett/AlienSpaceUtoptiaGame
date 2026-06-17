# The Historians — Full Source (Merged Build)

Complete source tree for the merged build: mainbranch (unlocked)
features + auth fork (locked) features, with mainbranch taking
priority on conflicts and the auth layer grafted on as additions.

## Contents

```
/
├── src/                       # React frontend (Vite)
│   ├── App.jsx                # Router + RequireAuth gating
│   ├── main.jsx               # ErrorBoundary + BrowserRouter + AuthProvider
│   ├── api/                   # Backend client wrappers
│   │   ├── client.js          # General API (decks, cards, scores)
│   │   ├── multiplayer.js     # MP endpoint wrappers
│   │   ├── mpSession.js       # Per-game localStorage tokens
│   │   └── auth.js            # Auth API (login, register, sessions, etc.)
│   ├── auth/                  # Auth scaffolding (from locked fork)
│   │   ├── AuthContext.jsx    # useAuth() provider
│   │   ├── RequireAuth.jsx    # Route gate
│   │   ├── AuthFrame.jsx      # Shared layout for login/register pages
│   │   └── useUserSetting.js  # Per-user setting hook (server-backed)
│   ├── components/            # Reusable UI components
│   ├── hooks/                 # Game-state hooks
│   ├── lib/                   # Pure logic (validation, sounds, toasts, etc.)
│   ├── pages/                 # Routed pages
│   │   ├── Home.jsx           # Landing — auth-aware, merged solo/MP
│   │   ├── Game.jsx           # Solo gameplay
│   │   ├── MultiplayerGame.jsx       # MP gameplay (chat, sound, etc.)
│   │   ├── MultiplayerWaitingRoom.jsx
│   │   ├── MultiplayerResults.jsx
│   │   ├── LeaderboardPage.jsx, WorksPage.jsx
│   │   ├── LoginPage.jsx, RegisterPage.jsx, ForgotPasswordPage.jsx,
│   │   │   ResetPasswordPage.jsx, VerifyEmailPage.jsx
│   │   ├── AccountPage.jsx
│   │   └── AdminInvitesPage.jsx
│   └── styles/                # Tailwind/global CSS
│
├── server-uploads/            # PHP backend (cPanel-deploy)
│   ├── users_*.php            # Auth + invites + scores + settings (12)
│   └── mp_*.php               # Multiplayer endpoints (22)
│
├── database/                  # SQL migrations (run in numbered order)
│   ├── 01_create_mp_tables.sql
│   ├── 02_manuscript_lifecycle_migration.sql
│   ├── 03_citation_support_migration.sql
│   ├── 04_user_accounts_migration.sql
│   ├── 05_invite_codes_migration.sql
│   ├── 06_user_scores_migration.sql
│   ├── 07_user_settings_tutorial_enabled.sql
│   ├── 08_chat_messages_migration.sql
│   └── bootstrap_admin_invite.sql
│
├── public/                    # Static assets
├── index.html                 # Vite entry
├── package.json, package-lock.json
├── vite.config.js, tailwind.config.js, postcss.config.js
└── README.md                  # This file
```

## Build

```
npm install
npm run build       # → dist/
npm run dev         # local dev server
```

## Deploy

See the `historians-merged-final.zip` artifact for a drop-in deploy
package (prebuilt dist + DB migrations + server PHP + DEPLOY.md).

This source bundle is for development / iteration on the codebase.
