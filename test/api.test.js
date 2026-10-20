const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'test-secret-that-is-at-least-thirty-two-characters';
const { app } = require('../server');

test('accounts own their expenses and dashboard totals', async () => {
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
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await new Promise(resolve => server.close(resolve));
  }
});
