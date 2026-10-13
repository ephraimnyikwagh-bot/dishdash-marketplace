# DishDash

DishDash is an on-demand food delivery marketplace. This repository currently
contains the Phase 1 project foundation and Phase 2 authentication/RBAC.

## Prerequisites

- Node.js 20 or newer
- MongoDB Atlas (replica-set cluster) **or** Docker Desktop for optional local
  MongoDB

Docker is optional. The server reads `MONGODB_URI` from `server/.env` and can
connect directly to an Atlas replica set. MongoDB transactions require a
replica-set or sharded deployment; the server checks transaction capability at
startup and logs a warning when it is unavailable or cannot be verified.

## Configure and run

1. Create `server/.env` using `.env.example` as a guide. Set `MONGODB_URI` to
   your Atlas connection string, `JWT_SECRET` to a random secret of at least 32
   characters, and `ADMIN_REGISTRATION_KEY` to a separate random secret.
2. In Atlas, allow your development IP and ensure the database user has the
   required read/write permissions.
3. Start the API:

   ```powershell
   Set-Location server
   npm.cmd install
   npm.cmd run dev
   ```

4. In a second terminal, start the client:

   ```powershell
   Set-Location client
   npm.cmd install
   npm.cmd run dev
   ```

   The client runs at `http://localhost:5173`; the API health check is
   `http://localhost:4000/api/health`.

### Optional local MongoDB

For local development instead of Atlas, run the single-node replica set:

```powershell
docker compose up -d mongo
```

Use `MONGODB_URI=mongodb://localhost:27017/food_marketplace?replicaSet=rs0`
in `server/.env`. Shut it down with `docker compose down`; add `-v` only if you
intend to remove its persisted local database volume.

## Environment variables

| Variable                 | Purpose                                              |
| ------------------------ | ---------------------------------------------------- |
| `NODE_ENV`               | Runtime environment                                  |
| `PORT`                   | API port (default `4000`)                            |
| `CLIENT_ORIGIN`          | Comma-separated allowed browser origins              |
| `MONGODB_URI`            | MongoDB Atlas or local replica-set connection string |
| `JWT_SECRET`             | Random signing key, at least 32 characters           |
| `JWT_EXPIRES_IN`         | JWT lifetime, for example `1d`                       |
| `ADMIN_REGISTRATION_KEY` | Secret required to register an admin account         |

Never commit `.env` files or put payment card details in application storage.

## Authentication API (Phase 2)

All routes are prefixed with `/api`.

| Method | Endpoint         | Access               | Description                                            |
| ------ | ---------------- | -------------------- | ------------------------------------------------------ |
| `POST` | `/auth/register` | Public, rate limited | Register a buyer, vendor, courier, or authorized admin |
| `POST` | `/auth/login`    | Public, rate limited | Verify credentials and receive a JWT                   |
| `GET`  | `/auth/me`       | Bearer JWT           | Return the authenticated user's public profile         |
| `GET`  | `/health`        | Public               | API health check                                       |

Registration accepts `name`, `email`, `password`, and optional `role` (defaults
to `buyer`). Registering as `admin` additionally requires
`adminRegistrationKey` matching the server's `ADMIN_REGISTRATION_KEY`. Passwords
are bcrypt-hashed; API responses never return password hashes. Login returns
the JWT as `token`. Send protected requests with
`Authorization: Bearer <token>`.

Role authorization middleware is available for subsequent protected API
routes: `requireAuth` authenticates the bearer token and `allowRoles("vendor")`
(or another role list) restricts access. Authentication and authorization
failures return HTTP 401 and 403 respectively.

## Checks

```powershell
Set-Location server
npm.cmd test
npm.cmd run lint

Set-Location ..\client
npm.cmd run lint
npm.cmd run build
```

The current authentication tests cover token verification, role authorization,
and registration validation without a live database. Successful registration
and login persistence will require a reachable MongoDB test database in later
integration tests.
