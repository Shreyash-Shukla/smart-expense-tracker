const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { advance } = require('../services/recurring');

process.env.JWT_SECRET = 'test-secret-that-is-at-least-thirty-two-characters';
const { app } = require('../server');

test('recurring cadence keeps the original monthly day', () => {
  assert.equal(advance('2025-01-31', 'monthly', 31), '2025-02-28');
  assert.equal(advance('2025-02-28', 'monthly', 31), '2025-03-31');
  assert.equal(advance('2024-02-29', 'monthly', 29), '2024-03-29');
  assert.equal(advance('2025-04-12', 'weekly', 12), '2025-04-19');
});

test('accounts own expenses, budgets, and recurring schedules', async () => {
  const database = `expense_tracker_test_${randomUUID().replaceAll('-', '')}`;
  await mongoose.connect(process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017', { dbName: database });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(path, method = 'GET', body, token) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, data: await response.json() };
  }

  try {
    assert.equal((await request('/api/health')).status, 200);
    const home = await fetch(base);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Smart Expense Tracker/);
    assert.equal((await request('/api/expenses')).status, 401);
    assert.equal((await request('/api/auth/register', 'POST', {})).status, 400);
    const first = await request('/api/auth/register', 'POST', { username: 'first', email: 'first@example.com', password: 'password123' });
    const second = await request('/api/auth/register', 'POST', { username: 'second', email: 'second@example.com', password: 'password123' });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const expense = await request('/api/expenses', 'POST', { title: 'Lunch', amount: 250, category: 'Food' }, first.data.token);
    assert.equal(expense.status, 201);
    assert.equal((await request('/api/expenses', 'GET', undefined, second.data.token)).data.total, 0);
    assert.equal((await request('/api/dashboard/stats', 'GET', undefined, first.data.token)).data.totalExpenses, 250);
    assert.equal((await request('/api/dashboard/stats', 'GET', undefined, second.data.token)).data.totalExpenses, 0);
    assert.equal((await request(`/api/expenses/${expense.data._id}`, 'PUT', { title: 'Changed', amount: 1, category: 'Food' }, second.data.token)).status, 404);
    const update = await request(`/api/expenses/${expense.data._id}`, 'PUT', { title: 'Dinner', amount: 300, category: 'Food', user: second.data.user.id }, first.data.token);
    assert.equal(update.status, 200);
    assert.equal(update.data.user, first.data.user.id);
    assert.equal((await request('/api/dashboard/stats', 'GET', undefined, first.data.token)).data.totalExpenses, 300);
    assert.equal((await request(`/api/expenses/${expense.data._id}`, 'DELETE', undefined, first.data.token)).status, 200);
    assert.equal((await request('/api/expenses', 'GET', undefined, first.data.token)).data.total, 0);
    const dated = await request('/api/expenses', 'POST', {
      title: 'Late bill', amount: 100, category: 'Bills', date: '2025-04-12T23:30:00.000Z'
    }, first.data.token);
    assert.equal(dated.status, 201);
    const filtered = await request('/api/expenses?category=Bills&startDate=2025-04-12T00%3A00%3A00.000Z&endDate=2025-04-12T23%3A59%3A59.999Z', 'GET', undefined, first.data.token);
    assert.equal(filtered.status, 200);
    assert.equal(filtered.data.total, 1);
    assert.equal(filtered.data.expenses[0]._id, dated.data._id);
    assert.equal((await request('/api/expenses?category=Food', 'GET', undefined, first.data.token)).data.total, 0);
    assert.equal((await request('/api/budgets/2025-04')).status, 401);
    assert.equal((await request('/api/budgets/2025-13', 'GET', undefined, first.data.token)).status, 400);
    assert.equal((await request('/api/budgets/2025-04', 'PUT', { amount: -1 }, first.data.token)).status, 400);
    const april = await request('/api/budgets/2025-04', 'GET', undefined, first.data.token);
    assert.equal(april.status, 200);
    assert.equal(april.data.budget, null);
    assert.equal(april.data.spent, 100);
    assert.equal((await request('/api/budgets/2025-04', 'GET', undefined, second.data.token)).data.spent, 0);
    const savedBudget = await request('/api/budgets/2025-04', 'PUT', { amount: 150 }, first.data.token);
    assert.equal(savedBudget.status, 200);
    assert.equal(savedBudget.data.remaining, 50);
    assert.equal((await request('/api/budgets/2025-04', 'GET', undefined, second.data.token)).data.budget, null);
    const changedBudget = await request('/api/budgets/2025-04', 'PUT', { amount: 80 }, first.data.token);
    assert.equal(changedBudget.data.remaining, -20);
    const mayExpense = await request('/api/expenses', 'POST', {
      title: 'May rent', amount: 500, category: 'Bills', date: '2025-05-01T00:00:00.000Z'
    }, first.data.token);
    assert.equal(mayExpense.status, 201);
    assert.equal((await request('/api/budgets/2025-04', 'GET', undefined, first.data.token)).data.spent, 100);
    assert.equal((await request('/api/budgets/2025-05', 'GET', undefined, first.data.token)).data.spent, 500);
    const clearedBudget = await request('/api/budgets/2025-04', 'DELETE', undefined, first.data.token);
    assert.equal(clearedBudget.status, 200);
    assert.equal(clearedBudget.data.budget, null);
    assert.equal((await request('/api/recurring')).status, 401);
    assert.equal((await request('/api/recurring', 'POST', { title: 'Bad', amount: 10, category: 'Bills', frequency: 'monthly', startDate: '2025-02-30' }, first.data.token)).status, 400);
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 2);
    const recurring = await request('/api/recurring', 'POST', {
      title: 'Daily commute', amount: 25, category: 'Transportation', frequency: 'daily',
      startDate: start.toISOString().slice(0, 10)
    }, first.data.token);
    assert.equal(recurring.status, 201);
    const recurringList = await request('/api/recurring', 'GET', undefined, first.data.token);
    assert.equal(recurringList.data.length, 1);
    assert.equal((await request('/api/recurring', 'GET', undefined, second.data.token)).data.length, 0);
    const transport = await request('/api/expenses?category=Transportation', 'GET', undefined, first.data.token);
    assert.equal(transport.data.total, 3);
    assert.equal(transport.data.expenses.filter(item => item.recurringRule === recurring.data._id).length, 3);
    assert.equal((await request('/api/expenses?category=Transportation', 'GET', undefined, second.data.token)).data.total, 0);
    assert.equal((await request(`/api/recurring/${recurring.data._id}`, 'PATCH', { active: false }, second.data.token)).status, 404);
    assert.equal((await request(`/api/recurring/${recurring.data._id}`, 'PATCH', { active: false }, first.data.token)).data.active, false);
    assert.equal((await request(`/api/recurring/${recurring.data._id}`, 'PATCH', { active: true }, first.data.token)).data.active, true);
    assert.equal((await request('/api/expenses?category=Transportation', 'GET', undefined, first.data.token)).data.total, 3);
    assert.equal((await request(`/api/recurring/${recurring.data._id}`, 'DELETE', undefined, first.data.token)).status, 200);
    assert.equal((await request('/api/recurring', 'GET', undefined, first.data.token)).data.length, 0);
    assert.equal((await request('/api/expenses?category=Transportation', 'GET', undefined, first.data.token)).data.total, 3);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await new Promise(resolve => server.close(resolve));
  }
});
