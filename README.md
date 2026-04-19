<<<<<<< HEAD
# smart-expense-tracker
This is the repository for my project of Smart Expense Tracker
=======
# Smart Expense Tracker

A full-stack finance tracker built with the MERN stack that provides comprehensive expense management with category-wise tracking and interactive dashboards.

## Features

- **User Authentication**: JWT-based secure authentication system
- **Expense Management**: Add, edit, delete, and categorize expenses
- **Interactive Dashboard**: Visual insights using Chart.js
- **Category-wise Tracking**: Organize expenses by categories (Food, Transportation, Entertainment, etc.)
- **REST APIs**: Scalable API endpoints with MongoDB integration
- **Responsive Design**: Modern UI built with React

## Tech Stack

- **Frontend**: React, Chart.js
- **Backend**: Node.js, Express.js
- **Database**: MongoDB
- **Authentication**: JWT (JSON Web Tokens)
- **Security**: bcryptjs for password hashing

## Installation

1. Clone the repository
2. Install server dependencies:
   ```bash
   npm install
   ```
3. Install client dependencies:
   ```bash
   npm run install-client
   ```
4. Create a `.env` file from `.env.example` and configure your MongoDB URI
5. Start the development server:
   ```bash
   npm run dev
   ```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `GET /api/auth/profile` - Get user profile

### Expenses
- `GET /api/expenses` - Get all expenses (with pagination and filtering)
- `POST /api/expenses` - Create new expense
- `PUT /api/expenses/:id` - Update expense
- `DELETE /api/expenses/:id` - Delete expense
- `GET /api/expenses/:id` - Get single expense

### Dashboard
- `GET /api/dashboard/stats` - Get dashboard statistics
- `GET /api/dashboard/categories` - Get category breakdown

## Project Structure

```
Smart-Expense-Tracker/
├── models/          # Mongoose models
├── routes/          # API routes
├── middleware/      # Custom middleware
├── client/          # React frontend
├── server.js        # Main server file
└── package.json     # Dependencies and scripts
```
>>>>>>> 4b7c261 (Initial commit)
