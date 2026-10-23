# Smart Expense Tracker

A small expense tracker with accounts, expense entry, history, monthly budgets, recurring expenses, and multiple currencies. The browser interface and API are served by one Node.js process.

## Run locally

Requirements: Node.js 20 or later and a MongoDB database.

1. Run `npm install`.
2. Copy `.env.example` to `.env` and set `MONGODB_URI` and a random `JWT_SECRET` of at least 32 characters. To enable password recovery, also set `APP_BASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and any SMTP authentication settings your provider requires. Do not commit `.env`.
3. Run `npm run dev`.
4. Open `http://localhost:5000`.

Run `npm test` for the API integration test. It uses a temporary database on local MongoDB; set `TEST_MONGODB_URI` to use another MongoDB server.

## Deploy

Deploy this repository as a Node web service on a host that supports persistent processes (for example, Render). Use `npm ci` as the build command and `npm start` as the start command. Set `MONGODB_URI` and `JWT_SECRET` in the host's environment settings. For recovery emails, set `APP_BASE_URL` to the public HTTPS URL and configure the SMTP settings in `.env.example`. `PORT` is read from the host automatically. Configure a MongoDB Atlas database user and network access for the web service. The service starts only after it connects to the database. `/api/health` returns HTTP 200 when connected.

The app supports INR, USD, EUR, GBP, CAD, AUD, SGD, AED, and CHF. Existing records without a currency are treated as INR. Totals and budgets stay separate by currency; the app does not apply exchange rates or combine unlike amounts. Due recurring entries are created when the user accesses the app; paused schedules skip missed dates, and removing a schedule keeps existing expense entries. Recurring dates use UTC calendar days. Password recovery uses a one-time email link that expires after 30 minutes and invalidates existing sign-in tokens; it requires SMTP configuration. Keep the server and database credentials private.

## API

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/profile`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`
- `GET /api/expenses`, `POST /api/expenses`, `GET /api/expenses/:id`, `PUT /api/expenses/:id`, `DELETE /api/expenses/:id` (`currency` defaults to INR; list accepts a `currency` filter)
- `GET /api/dashboard/stats`, `GET /api/dashboard/categories` (totals and breakdowns include currency; legacy `totalExpenses` is the INR total)
- `GET /api/budgets/:month`, `PUT /api/budgets/:month`, `DELETE /api/budgets/:month` (`month` is `YYYY-MM`; optional `currency` query defaults to INR; spending uses UTC calendar months)
- `GET /api/recurring`, `POST /api/recurring`, `PATCH /api/recurring/:id` (pause/resume), `DELETE /api/recurring/:id`
- `GET /api/health`

Expense, dashboard, budget, and recurring endpoints require an `Authorization: Bearer <token>` header.
