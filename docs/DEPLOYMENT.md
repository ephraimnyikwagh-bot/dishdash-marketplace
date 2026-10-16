# DishDash free-tier deployment

This guide deploys the React SPA to Vercel Hobby, the Express API to a Render
free web service, MongoDB to Atlas, and product images to Cloudinary. Keep
`DEMO_MODE=false` by default; enable it only for a public demo instance using
test data and the mock payment provider.

## 1. MongoDB Atlas

1. Sign in to [MongoDB Atlas](https://cloud.mongodb.com/) and click **Build a
   Database** (or **Create** if the organization already has a project).
2. Select the **M0 Free** tier, choose a region near your Render service, and
   click **Create Deployment**.
3. Under **Security → Database Access**, choose **Add New Database User**.
   Create a dedicated application user with a strong generated password and
   **Read and write to any database** for this MVP. Save the password securely.
4. Under **Security → Network Access**, click **Add IP Address**, choose **Allow
   Access from Anywhere** (`0.0.0.0/0`), and confirm. Render free outbound IPs
   are not fixed; restrict this list to Render's documented outbound addresses
   if you move to a plan/service that provides stable egress IPs.
5. In **Database → Connect → Drivers**, copy the `mongodb+srv://` URI. Replace
   `<password>` with the database user's URL-encoded password and set the
   database name, e.g. `dishdash`. Atlas replica-set clusters support the
   multi-document transactions used by checkout and refunds.

## 2. Cloudinary

1. Sign up at [Cloudinary](https://cloudinary.com/), open the **Dashboard**, and
   copy **Cloud name**, **API Key**, and **API Secret**.
2. Add these as Render environment variables in the next step. Never add the
   API secret to Vercel or any `VITE_*` variable.
3. The upload service uses signed Cloudinary uploads whenever any Cloudinary
   variable is set and requires all three. Without them, it uses local storage
   only outside production; production image uploads fail clearly rather than
   writing to Render's ephemeral filesystem.

## 3. Render API

1. Push the repository to a GitHub repository. Ensure `.env` files and uploaded
   images are ignored and not tracked.
2. Sign in to [Render](https://dashboard.render.com/), click **New + → Blueprint**,
   connect the repository, and click **Apply**. Render reads the root
   `render.yaml`, creates a free web service rooted at `server`, and configures
   `/api/health` as the health check.
3. In the service, open **Environment**. Fill the variables marked as
   **Secret** or `sync: false`:

   | Variable | Value |
   | --- | --- |
   | `MONGODB_URI` | Atlas connection URI for the app database |
   | `CLIENT_ORIGIN` | Exact Vercel production origin, e.g. `https://dishdash-demo.vercel.app` (comma-separate additional permitted origins) |
   | `ADMIN_REGISTRATION_KEY` | Long random value; needed only when registering an admin |
   | `CLOUDINARY_CLOUD_NAME` | Cloudinary dashboard cloud name |
   | `CLOUDINARY_API_KEY` | Cloudinary dashboard API key |
   | `CLOUDINARY_API_SECRET` | Cloudinary dashboard API secret |
   | `FLW_SECRET_KEY` | Optional Flutterwave **TEST** key; leave empty for mock demo |
   | `FLW_PUBLIC_KEY` | Optional Flutterwave **TEST** key; leave empty for mock demo |
   | `FLW_WEBHOOK_HASH` | Optional Flutterwave test webhook hash; leave empty for mock demo |
   | `FLW_REDIRECT_URL` | Optional URL on the deployed frontend for hosted test checkout |

   Render sets `NODE_ENV=production`, `PORT` at runtime, `JWT_SECRET` (generated
   by the blueprint), `PAYMENT_PROVIDER=mock`, `DEMO_MODE=false`,
   `PLATFORM_FEE_BPS=1000`, and `FLW_BASE_URL` from `render.yaml`. Never
   hard-code a Render port; the server listens on `process.env.PORT`.
4. Click **Save, rebuild, and deploy**. Open the service URL ending in
   `/api/health`; it should return `{"status":"ok"}`. The first request after
   inactivity can be slow because the free web service sleeps; wait for the
   deploy/wake-up before testing.
5. Enable deployment demo mode only for a demo: in **Environment**, set
   `DEMO_MODE=true` and keep `PAYMENT_PROVIDER=mock`, then save/redeploy.
   This explicitly enables mock payment simulations in production and allows
   the seed script to run. Do not enable this on an instance processing real
   payments or real customer data.

## 4. Vercel client

1. Sign in to [Vercel](https://vercel.com/), click **Add New → Project**, import
   the same GitHub repository, and set **Root Directory** to `client`.
2. Confirm the framework preset is **Vite**. Leave the build command as
   `npm run build` and the output directory as `dist`; click **Deploy**.
   `client/vercel.json` rewrites browser routes to `index.html`, so refreshing
   `/orders` and other React Router paths serves the SPA.
3. After deployment, copy the Vercel production domain. In Render, update
   `CLIENT_ORIGIN` to that exact origin (no trailing slash), save, and redeploy.
4. In Vercel **Project → Settings → Environment Variables**, add these for
   **Production** (and Preview only if you also add that preview origin to
   Render's `CLIENT_ORIGIN`):

   | Variable | Production value |
   | --- | --- |
   | `VITE_API_URL` | `https://<your-render-service>.onrender.com/api` |
   | `VITE_SOCKET_URL` | `https://<your-render-service>.onrender.com` |
   | `VITE_DEMO_MODE` | `false` normally; set `true` only for a demo deployment where Render `DEMO_MODE=true` and `PAYMENT_PROVIDER=mock` |

   These are public build-time settings, not secrets. Do not place JWT secrets,
   database credentials, Cloudinary secrets, or Flutterwave secret keys in
   Vercel. Click **Redeploy** after changing a Vite variable because values are
   compiled into the frontend bundle.
5. Check the deployed site, sign in, load products, and open an order details
   page. Socket.IO is configured to allow both WebSocket and HTTP long-polling
   transports; both use the same `CLIENT_ORIGIN` allowlist as Express CORS.

## Receipts and Render's ephemeral filesystem

DishDash stores generated receipt PDF bytes in the Atlas `Receipt` document,
not as files on Render's local disk. Therefore a Render restart does not remove
an already generated receipt. The authorized receipt endpoint also regenerates
the PDF on demand if the stored document exists but its PDF bytes are missing
or invalid, while enforcing buyer/vendor/admin access before generation.

## 5. Seed the demo database

Only seed after confirming the Render instance is the intended demo database.
For production demo seeding and mock payment simulation, set `DEMO_MODE=true`
and `PAYMENT_PROVIDER=mock` in Render, then save and redeploy. Both flags are
configured with demo controls disabled by default.

1. Open the Vercel site and click **Register**. Create an admin account using a
   unique email/password, choose the **Admin** role, and enter the Render
   `ADMIN_REGISTRATION_KEY`. This key is submitted to the API; it is not a
   `VITE_*` variable.
2. From PowerShell, run the following after replacing the Render URL and the
   email used for that admin account. It prompts securely for the password and
   calls the admin-only seeding endpoint:

   ```powershell
   $api = "https://<your-render-service>.onrender.com/api"
   $email = Read-Host "Admin email"
   $securePassword = Read-Host "Admin password" -AsSecureString
   $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
   try {
     $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
     $loginBody = @{ email = $email; password = $password } | ConvertTo-Json
     $session = Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType "application/json" -Body $loginBody
     Invoke-RestMethod -Method Post -Uri "$api/admin/demo-seed" -Headers @{ Authorization = "Bearer $($session.token)" }
   }
   finally {
     [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
     Remove-Variable password, loginBody, session -ErrorAction SilentlyContinue
   }
   ```

3. Confirm the response says `Demo data seeded successfully`. The seed
   command upserts four demo users and ten dishes; rerunning it is safe, though
   it resets those demo accounts to the documented shared demo password.
4. Log in at the Vercel site using `buyer@dishdash.demo`,
   `vendor@dishdash.demo`, `courier@dishdash.demo`, or `admin@dishdash.demo`.
   The shared password is `DishDashDemo2026!`. These credentials are public
   demo credentials, not suitable for private or production data.

The same protected script can be run from Render Shell with `npm run seed` if
Shell is available on the selected service plan.

## Environment-variable inventory

### Render (server)

`NODE_ENV`, `PORT` (provided by Render), `DEMO_MODE`, `CLIENT_ORIGIN`,
`MONGODB_URI`, `JWT_SECRET` (generated), `JWT_EXPIRES_IN`,
`ADMIN_REGISTRATION_KEY`, `PAYMENT_PROVIDER`, `PLATFORM_FEE_BPS`,
`FLW_SECRET_KEY`, `FLW_PUBLIC_KEY`, `FLW_WEBHOOK_HASH`, `FLW_BASE_URL`,
`FLW_REDIRECT_URL`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
`CLOUDINARY_API_SECRET`. For offline mock demo, use `PAYMENT_PROVIDER=mock`;
Flutterwave is restricted to TEST credentials and is optional.

### Vercel (client)

`VITE_API_URL`, `VITE_SOCKET_URL`, and `VITE_DEMO_MODE`. Vite variables are
visible in downloaded browser assets; only set public URLs and the demo UI
flag here.

### Atlas and Cloudinary

Atlas database user credentials are embedded only in the secret Render
`MONGODB_URI`. Cloudinary cloud name/API key/API secret are configured only in
Render; do not use them as `VITE_*` variables.

## Pre-demo checklist

- [ ] Wake the Render free API first by opening `/api/health`, then wait for
  `{"status":"ok"}` before opening the client.
- [ ] Confirm Render `CLIENT_ORIGIN` exactly matches the Vercel site origin.
- [ ] Confirm Atlas IP access list permits Render and its database user/URI is
  valid.
- [ ] Confirm all three Cloudinary variables are set and upload one test image.
- [ ] For mock-payment demo only, confirm `DEMO_MODE=true` and
  `PAYMENT_PROVIDER=mock` in Render and `VITE_DEMO_MODE=true` in Vercel, then
  redeploy both services as needed.
- [ ] Register a temporary admin, then call `POST /api/admin/demo-seed` once
  after demo mode is enabled.
- [ ] Test buyer login, checkout simulation success and failure, vendor/courier
  status updates, receipt download, admin dashboard, and ledger integrity.
- [ ] After the demo, set both demo mode variables back to `false`, redeploy,
  and remove seeded data if it is no longer needed.
