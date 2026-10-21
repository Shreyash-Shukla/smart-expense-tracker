# Smart Expense Tracker

A small expense tracker with accounts, expense entry, history, and monthly budgets. The browser interface and API are served by one Node.js process. Amounts are displayed in INR.

## Run locally

Requirements: Node.js 20 or later and a MongoDB database.

1. Run `npm install`.
2. Copy `.env.example` to `.env` and set `MONGODB_URI` and a random `JWT_SECRET` of at least 32 characters. Do not commit `.env`.
3. Run `npm run dev`.
4. Open `http://localhost:5000`.

Run `npm test` for the API integration test. It uses a temporary database on local MongoDB; set `TEST_MONGODB_URI` to use another MongoDB server.

## Deploy

Deploy this repository as a Node web service on a host that supports persistent processes (for example, Render). Use `npm ci` as the build command and `npm start` as the start command. Set `MONGODB_URI` and `JWT_SECRET` in the host's environment settings. `PORT` is read from the host automatically. Configure a MongoDB Atlas database user and network access for the web service. The service starts only after it connects to the database. `/api/health` returns HTTP 200 when connected.

The app includes a monthly budget planner. It does not yet have recurring expenses, multi-currency support, or password recovery. Keep the server and database credentials private.

## API

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/profile`
- `GET /api/expenses`, `POST /api/expenses`, `GET /api/expenses/:id`, `PUT /api/expenses/:id`, `DELETE /api/expenses/:id`
- `GET /api/dashboard/stats`, `GET /api/dashboard/categories`
- `GET /api/budgets/:month`, `PUT /api/budgets/:month`, `DELETE /api/budgets/:month` (`month` is `YYYY-MM`; spending uses UTC calendar months)
- `GET /api/health`

Expense, dashboard, and budget endpoints require an `Authorization: Bearer <token>` header.
