const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const { advance } = require('../services/recurring');
const { periodStartDate } = require('../routes/dashboard');
const PasswordResetToken = require('../models/PasswordResetToken');
const Expense = require('../models/Expense');
const Budget = require('../models/Budget');
const CategoryBudget = require('../models/CategoryBudget');
const RecurringExpense = require('../models/RecurringExpense');
const User = require('../models/User');

process.env.JWT_SECRET = 'test-secret-that-is-at-least-thirty-two-characters';
process.env.APP_BASE_URL = 'https://tracker.example.test';
process.env.SMTP_HOST = 'smtp.example.test';
process.env.SMTP_PORT = '587';
process.env.SMTP_FROM = 'support@example.test';
const sentMail = [];
nodemailer.createTransport = () => ({ sendMail: async message => { sentMail.push(message); } });
const { app } = require('../server');

test('recurring cadence keeps the original monthly day', () => {
  assert.equal(advance('2025-01-31', 'monthly', 31), '2025-02-28');
  assert.equal(advance('2025-02-28', 'monthly', 31), '2025-03-31');
  assert.equal(advance('2024-02-29', 'monthly', 29), '2024-03-29');
  assert.equal(advance('2025-04-12', 'weekly', 12), '2025-04-19');
});

test('periodStartDate handles month-end and leap-year boundaries correctly', () => {
  const march31 = new Date('2025-03-31T12:00:00.000Z');
  const may31 = new Date('2025-05-31T12:00:00.000Z');
  const feb29Leap = new Date('2024-02-29T12:00:00.000Z');
  assert.equal(periodStartDate('month', march31).toISOString().slice(0, 10), '2025-02-28');
  assert.equal(periodStartDate('month', may31).toISOString().slice(0, 10), '2025-04-30');
  assert.equal(periodStartDate('year', feb29Leap).toISOString().slice(0, 10), '2023-02-28');
  assert.equal(periodStartDate('week', march31).toISOString().slice(0, 10), '2025-03-24');
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
    const html = await home.text();
    assert.match(html, /Smart Expense Tracker/);
    assert.match(html, /Forgot password\?/);
    assert.match(html, /Spending insights/);
    assert.match(html, /Category limits/);
    assert.match(html, /id="budget-alerts"/);
    assert.match(html, /id="budget-copy"/);
    assert.match(html, /Export CSV/);
    assert.match(html, /Search title or note/);
    assert.match(html, /id="filter-sort"/);
    assert.match(html, /id="filter-date-preset"/);
    assert.match(html, /id="history-summary"/);
    assert.match(html, /id="change-password-form"/);
    assert.match(html, /id="currency-preference-form"/);
    assert.match(html, /id="delete-account-button"/);
    assert.equal((await request('/api/expenses')).status, 401);
    assert.equal((await request('/api/auth/register', 'POST', {})).status, 400);
    const first = await request('/api/auth/register', 'POST', { username: 'first', email: 'first@example.com', password: 'password123' });
    const second = await request('/api/auth/register', 'POST', { username: 'second', email: 'second@example.com', password: 'password123' });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(first.data.user.preferredCurrency, 'INR');
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
      title: 'Late bill', amount: 100, category: 'Bills', description: 'Unit A.', date: '2025-04-12T23:30:00.000Z'
    }, first.data.token);
    assert.equal(dated.status, 201);
    const filtered = await request('/api/expenses?category=Bills&startDate=2025-04-12T00%3A00%3A00.000Z&endDate=2025-04-12T23%3A59%3A59.999Z', 'GET', undefined, first.data.token);
    assert.equal(filtered.status, 200);
    assert.equal(filtered.data.total, 1);
    assert.deepEqual(filtered.data.totalsByCurrency, [{ _id: 'INR', total: 100 }]);
    assert.equal(filtered.data.expenses[0]._id, dated.data._id);
    assert.equal((await request('/api/expenses?category=Food', 'GET', undefined, first.data.token)).data.total, 0);
    assert.equal((await request('/api/expenses', 'POST', { title: 'Bad cents', amount: 1.234, category: 'Food' }, first.data.token)).status, 400);
    assert.equal((await request('/api/expenses/not-an-id', 'GET', undefined, first.data.token)).status, 400);
    assert.equal((await request('/api/budgets/2025-04')).status, 401);
    assert.equal((await request('/api/budgets/2025-13', 'GET', undefined, first.data.token)).status, 400);
    assert.equal((await request('/api/budgets/2025-04', 'PUT', { amount: -1 }, first.data.token)).status, 400);
    const april = await request('/api/budgets/2025-04', 'GET', undefined, first.data.token);
    assert.equal(april.status, 200);
    assert.equal(april.data.budget, null);
    assert.equal(april.data.spent, 100);
    assert.deepEqual(april.data.alerts, []);
    assert.equal((await request('/api/budgets/2025-04', 'GET', undefined, second.data.token)).data.spent, 0);
    const savedBudget = await request('/api/budgets/2025-04', 'PUT', { amount: 150 }, first.data.token);
    assert.equal(savedBudget.status, 200);
    assert.equal(savedBudget.data.remaining, 50);
    assert.deepEqual(savedBudget.data.alerts, []);
    assert.equal((await request('/api/budgets/2025-04', 'GET', undefined, second.data.token)).data.budget, null);
    const nearBudget = await request('/api/budgets/2025-04', 'PUT', { amount: 125 }, first.data.token);
    assert.deepEqual(nearBudget.data.alerts, [
      { scope: 'overall', level: 'near', budget: 125, spent: 100, remaining: 25 }
    ]);
    const reachedBudget = await request('/api/budgets/2025-04', 'PUT', { amount: 100 }, first.data.token);
    assert.equal(reachedBudget.data.alerts[0].level, 'reached');
    const changedBudget = await request('/api/budgets/2025-04', 'PUT', { amount: 80 }, first.data.token);
    assert.equal(changedBudget.data.remaining, -20);
    assert.deepEqual(changedBudget.data.alerts, [
      { scope: 'overall', level: 'over', budget: 80, spent: 100, remaining: -20 }
    ]);
    assert.equal(changedBudget.data.categories.find(item => item.category === 'Bills').spent, 100);
    assert.equal((await request('/api/budgets/2025-04/categories/Unknown', 'PUT', { amount: 50 }, first.data.token)).status, 400);
    assert.equal((await request('/api/budgets/2025-04/categories/Bills', 'PUT', { amount: 1.234 }, first.data.token)).status, 400);
    const categoryLimit = await request('/api/budgets/2025-04/categories/Bills', 'PUT', { amount: 90 }, first.data.token);
    assert.equal(categoryLimit.status, 200);
    assert.deepEqual(categoryLimit.data.categories.find(item => item.category === 'Bills'),
      { category: 'Bills', budget: 90, spent: 100, remaining: -10 });
    assert.deepEqual(categoryLimit.data.alerts.find(item => item.category === 'Bills'),
      { scope: 'category', category: 'Bills', level: 'over', budget: 90, spent: 100, remaining: -10 });
    assert.equal(categoryLimit.data.budget, 80);
    assert.equal((await request('/api/budgets/2025-04', 'GET', undefined, second.data.token)).data.categories
      .find(item => item.category === 'Bills').budget, null);
    const otherCategoryLimit = await request('/api/budgets/2025-04/categories/Food', 'PUT', { amount: 25 }, first.data.token);
    assert.equal(otherCategoryLimit.data.categories.find(item => item.category === 'Food').spent, 0);
    assert.equal(otherCategoryLimit.data.alerts.some(item => item.category === 'Food'), false);
    assert.equal((await request('/api/budgets/2025-04/categories/Bills', 'PUT', { amount: 125 }, first.data.token)).data.alerts
      .find(item => item.category === 'Bills').level, 'near');
    assert.equal((await request('/api/budgets/2025-04/categories/Bills', 'PUT', { amount: 100 }, first.data.token)).data.alerts
      .find(item => item.category === 'Bills').level, 'reached');
    assert.equal((await request('/api/budgets/2025-04/categories/Bills', 'PUT', { amount: 120 }, first.data.token)).data.categories
      .find(item => item.category === 'Bills').remaining, 20);
    assert.equal((await request('/api/budgets/2025-04/categories/Bills', 'DELETE', undefined, second.data.token)).data.categories
      .find(item => item.category === 'Bills').budget, null);
    assert.equal((await request('/api/budgets/2025-04', 'GET', undefined, first.data.token)).data.categories
      .find(item => item.category === 'Bills').budget, 120);
    assert.equal((await request('/api/budgets/2025-04/categories/Bills', 'DELETE', undefined, first.data.token)).data.categories
      .find(item => item.category === 'Bills').budget, null);
    assert.equal((await request('/api/budgets/2025-04', 'GET', undefined, first.data.token)).data.alerts
      .some(item => item.category === 'Bills'), false);
    const mayExpense = await request('/api/expenses', 'POST', {
      title: 'May rent', amount: 500, category: 'Bills', date: '2025-05-01T00:00:00.000Z'
    }, first.data.token);
    assert.equal(mayExpense.status, 201);
    const titleSearch = await request('/api/expenses?search=RENT&category=Bills', 'GET', undefined, first.data.token);
    assert.equal(titleSearch.data.total, 1);
    assert.equal(titleSearch.data.expenses[0]._id, mayExpense.data._id);
    assert.equal((await request('/api/expenses?search=unit%20a', 'GET', undefined, first.data.token)).data.expenses[0]._id, dated.data._id);
    assert.equal((await request('/api/expenses?search=.', 'GET', undefined, first.data.token)).data.total, 1);
    assert.equal((await request('/api/expenses?search=rent&endDate=2025-04-30', 'GET', undefined, first.data.token)).data.total, 0);
    assert.equal((await request('/api/expenses?search=rent', 'GET', undefined, second.data.token)).data.total, 0);
    assert.equal((await request(`/api/expenses?search=${'x'.repeat(101)}`, 'GET', undefined, first.data.token)).status, 400);
    assert.equal((await request('/api/expenses?search[]=rent', 'GET', undefined, first.data.token)).status, 400);
    const searchExport = await fetch(`${base}/api/expenses/export.csv?search=rent`, {
      headers: { Authorization: `Bearer ${first.data.token}` }
    });
    assert.equal(searchExport.status, 200);
    const searchCsv = await searchExport.text();
    assert.match(searchCsv, /May rent/);
    assert.doesNotMatch(searchCsv, /Late bill/);
    assert.equal((await request('/api/expenses/export.csv?search[]=rent', 'GET', undefined, first.data.token)).status, 400);
    assert.equal((await request('/api/budgets/2025-04', 'GET', undefined, first.data.token)).data.spent, 100);
    assert.equal((await request('/api/budgets/2025-05', 'GET', undefined, first.data.token)).data.spent, 500);
    const clearedBudget = await request('/api/budgets/2025-04', 'DELETE', undefined, first.data.token);
    assert.equal(clearedBudget.status, 200);
    assert.equal(clearedBudget.data.budget, null);
    assert.deepEqual(clearedBudget.data.alerts, []);
    await Expense.collection.updateOne({ _id: new mongoose.Types.ObjectId(dated.data._id) }, { $unset: { currency: '' } });
    assert.equal((await request('/api/budgets/2025-04', 'GET', undefined, first.data.token)).data.spent, 100);
    assert.equal((await request('/api/expenses?currency=INR', 'GET', undefined, first.data.token)).data.total, 2);
    assert.equal((await request('/api/expenses', 'POST', {
      title: 'Bad currency', amount: 10, currency: 'XYZ', category: 'Food'
    }, first.data.token)).status, 400);
    const usdExpense = await request('/api/expenses', 'POST', {
      title: 'Coffee', amount: 10, currency: 'USD', category: 'Food'
    }, first.data.token);
    const eurExpense = await request('/api/expenses', 'POST', {
      title: 'Lunch', amount: 20, currency: 'EUR', category: 'Food'
    }, first.data.token);
    assert.equal(usdExpense.status, 201);
    assert.equal(eurExpense.status, 201);
    const exported = await fetch(`${base}/api/expenses/export.csv?currency=USD`, {
      headers: { Authorization: `Bearer ${first.data.token}` }
    });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type'), /text\/csv/);
    const csv = await exported.text();
    assert.match(csv, /Coffee/);
    assert.doesNotMatch(csv, /Lunch/);
    assert.equal((await request('/api/expenses/export.csv?currency=XYZ', 'GET', undefined, first.data.token)).status, 400);
    assert.equal((await request('/api/expenses/export.csv?sort=bad', 'GET', undefined, first.data.token)).status, 400);
    const sortedExport = await fetch(`${base}/api/expenses/export.csv?sort=amount_desc`, {
      headers: { Authorization: `Bearer ${first.data.token}` }
    });
    assert.equal(sortedExport.status, 200);
    const usdExpenses = await request('/api/expenses?currency=USD', 'GET', undefined, first.data.token);
    assert.equal(usdExpenses.data.total, 1);
    assert.deepEqual(usdExpenses.data.totalsByCurrency, [{ _id: 'USD', total: 10 }]);
    const descExpenses = await request('/api/expenses?sort=amount_desc', 'GET', undefined, first.data.token);
    assert.equal(descExpenses.status, 200);
    assert.ok(descExpenses.data.expenses[0].amount >= descExpenses.data.expenses[descExpenses.data.expenses.length - 1].amount);
    const ascExpenses = await request('/api/expenses?sort=amount_asc', 'GET', undefined, first.data.token);
    assert.equal(ascExpenses.status, 200);
    assert.ok(ascExpenses.data.expenses[0].amount <= ascExpenses.data.expenses[ascExpenses.data.expenses.length - 1].amount);
    const oldestExpenses = await request('/api/expenses?sort=date_asc', 'GET', undefined, first.data.token);
    assert.equal(oldestExpenses.status, 200);
    assert.ok(new Date(oldestExpenses.data.expenses[0].date) <= new Date(oldestExpenses.data.expenses[oldestExpenses.data.expenses.length - 1].date));
    assert.equal((await request('/api/expenses?sort=invalid', 'GET', undefined, first.data.token)).status, 400);
    const mixedStats = await request('/api/dashboard/stats', 'GET', undefined, first.data.token);
    assert.equal(mixedStats.data.totalExpenses, 0);
    assert.deepEqual(Object.fromEntries(mixedStats.data.totalsByCurrency.map(item => [item._id, item.total])), { EUR: 20, USD: 10 });
    const foodBreakdown = await request('/api/dashboard/categories', 'GET', undefined, first.data.token);
    assert.deepEqual(Object.fromEntries(foodBreakdown.data.filter(item => item._id.category === 'Food')
      .map(item => [item._id.currency, item.total])), { EUR: 20, USD: 10 });
    assert.equal((await request('/api/dashboard/stats?period=week', 'GET', undefined, first.data.token)).status, 200);
    assert.equal((await request('/api/dashboard/stats?period=year', 'GET', undefined, first.data.token)).status, 200);
    const currentMonth = new Date().toISOString().slice(0, 7);
    assert.equal((await request(`/api/budgets/${currentMonth}?currency=XYZ`, 'GET', undefined, first.data.token)).status, 400);
    const usdBudget = await request(`/api/budgets/${currentMonth}?currency=USD`, 'PUT', { amount: 15 }, first.data.token);
    assert.equal(usdBudget.status, 200);
    assert.equal(usdBudget.data.remaining, 5);
    assert.equal((await request(`/api/budgets/${currentMonth}`, 'PUT', { amount: 100 }, first.data.token)).data.spent, 0);
    assert.equal((await request(`/api/budgets/${currentMonth}?currency=USD`, 'GET', undefined, first.data.token)).data.budget, 15);
    assert.equal((await request(`/api/budgets/${currentMonth}?currency=USD`, 'DELETE', undefined, first.data.token)).data.budget, null);
    assert.equal((await request(`/api/budgets/${currentMonth}`, 'GET', undefined, first.data.token)).data.budget, 100);
    const usdFood = await request(`/api/budgets/${currentMonth}/categories/Food?currency=USD`, 'PUT', { amount: 5 }, first.data.token);
    assert.equal(usdFood.data.categories.find(item => item.category === 'Food').remaining, -5);
    assert.equal(usdFood.data.alerts.find(item => item.category === 'Food').level, 'over');
    assert.equal((await request(`/api/budgets/${currentMonth}`, 'GET', undefined, first.data.token)).data.categories
      .find(item => item.category === 'Food').budget, null);
    assert.equal((await request(`/api/budgets/${currentMonth}`, 'GET', undefined, first.data.token)).data.alerts
      .some(item => item.category === 'Food'), false);
    const changedCurrency = await request(`/api/expenses/${usdExpense.data._id}`, 'PUT', {
      title: 'Coffee', amount: 12, currency: 'GBP', category: 'Food'
    }, first.data.token);
    assert.equal(changedCurrency.data.currency, 'GBP');
    assert.equal((await request('/api/expenses?currency=USD', 'GET', undefined, first.data.token)).data.total, 0);
    assert.equal((await request(`/api/budgets/${currentMonth}?currency=USD`, 'GET', undefined, first.data.token)).data.categories
      .find(item => item.category === 'Food').spent, 0);
    assert.equal((await request(`/api/budgets/${currentMonth}?currency=GBP`, 'GET', undefined, first.data.token)).data.categories
      .find(item => item.category === 'Food').spent, 12);
    assert.equal((await request('/api/recurring')).status, 401);
    assert.equal((await request('/api/recurring', 'POST', { title: 'Bad', amount: 10, category: 'Bills', frequency: 'monthly', startDate: '2025-02-30' }, first.data.token)).status, 400);
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 2);
    const recurring = await request('/api/recurring', 'POST', {
      title: 'Daily commute', amount: 25, currency: 'USD', category: 'Transportation', frequency: 'daily',
      startDate: start.toISOString().slice(0, 10)
    }, first.data.token);
    assert.equal(recurring.status, 201);
    const recurringList = await request('/api/recurring', 'GET', undefined, first.data.token);
    assert.equal(recurringList.data.length, 1);
    assert.equal((await request('/api/recurring', 'GET', undefined, second.data.token)).data.length, 0);
    const transport = await request('/api/expenses?category=Transportation', 'GET', undefined, first.data.token);
    assert.equal(transport.data.total, 3);
    assert.equal(transport.data.expenses.filter(item => item.recurringRule === recurring.data._id).length, 3);
    assert.equal(transport.data.expenses.every(item => item.currency === 'USD'), true);
    assert.equal((await request('/api/expenses?category=Transportation', 'GET', undefined, second.data.token)).data.total, 0);
    assert.equal((await request(`/api/recurring/${recurring.data._id}`, 'PATCH', { active: false }, second.data.token)).status, 404);
    assert.equal((await request(`/api/recurring/${recurring.data._id}`, 'PATCH', { active: false }, first.data.token)).data.active, false);
    assert.equal((await request(`/api/recurring/${recurring.data._id}`, 'PATCH', { active: true }, first.data.token)).data.active, true);
    assert.equal((await request('/api/expenses?category=Transportation', 'GET', undefined, first.data.token)).data.total, 3);
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 2);
    const updateRecurring = { title: 'Updated commute', amount: 30, currency: 'EUR', category: 'Transportation',
      frequency: 'weekly', startDate: future.toISOString().slice(0, 10), description: 'Train' };
    assert.equal((await request(`/api/recurring/${recurring.data._id}`, 'PUT', updateRecurring, second.data.token)).status, 404);
    assert.equal((await request(`/api/recurring/${recurring.data._id}`, 'PUT', { ...updateRecurring, amount: 1.234 }, first.data.token)).status, 400);
    const updatedRecurring = await request(`/api/recurring/${recurring.data._id}`, 'PUT', updateRecurring, first.data.token);
    assert.equal(updatedRecurring.status, 200);
    assert.equal(updatedRecurring.data.title, 'Updated commute');
    assert.equal(updatedRecurring.data.nextDate, updateRecurring.startDate);
    assert.equal((await request('/api/expenses?category=Transportation', 'GET', undefined, first.data.token)).data.total, 3);
    assert.equal((await request(`/api/recurring/${recurring.data._id}`, 'DELETE', undefined, first.data.token)).status, 200);
    assert.equal((await request('/api/recurring', 'GET', undefined, first.data.token)).data.length, 0);
    assert.equal((await request('/api/expenses?category=Transportation', 'GET', undefined, first.data.token)).data.total, 3);
    const unknownRecovery = await request('/api/auth/forgot-password', 'POST', { email: 'unknown@example.com' });
    assert.equal(unknownRecovery.status, 200);
    assert.equal(sentMail.length, 0);
    const recovery = await request('/api/auth/forgot-password', 'POST', { email: 'first@example.com' });
    assert.equal(recovery.status, 200);
    assert.deepEqual(recovery.data, unknownRecovery.data);
    assert.equal(sentMail.length, 1);
    assert.equal(sentMail[0].to, 'first@example.com');
    assert.match(sentMail[0].text, /https:\/\/tracker\.example\.test\/#reset=/);
    const resetToken = /#reset=([a-f0-9]{64})/.exec(sentMail[0].text)?.[1];
    assert.ok(resetToken);
    assert.equal(JSON.stringify(recovery.data).includes(resetToken), false);
    const storedReset = await PasswordResetToken.findOne({ user: first.data.user.id });
    assert.notEqual(storedReset.tokenHash, resetToken);
    assert.equal((await request('/api/auth/reset-password', 'POST', { token: resetToken, password: 'short' })).status, 400);
    assert.equal((await request('/api/auth/reset-password', 'POST', { token: resetToken, password: 'new-password-123' })).status, 200);
    assert.equal((await request('/api/auth/profile', 'GET', undefined, first.data.token)).status, 401);
    assert.equal((await request('/api/auth/profile', 'GET', undefined, second.data.token)).status, 200);
    assert.equal((await request('/api/auth/login', 'POST', { email: 'first@example.com', password: 'password123' })).status, 400);
    const reLogin = await request('/api/auth/login', 'POST', { email: 'first@example.com', password: 'new-password-123' });
    assert.equal(reLogin.status, 200);
    const badToken = jwt.sign({ userId: 'not-an-object-id', sessionVersion: 0 }, process.env.JWT_SECRET);
    assert.equal((await request('/api/auth/profile', 'GET', undefined, badToken)).status, 401);
    assert.equal((await request('/api/auth/register', 'POST', { username: '  first  ', email: 'third@example.com', password: 'password123' })).status, 400);
    assert.equal((await request('/api/dashboard/stats?period=invalid', 'GET', undefined, reLogin.data.token)).status, 200);
    assert.equal((await request('/api/dashboard/categories?period=invalid', 'GET', undefined, reLogin.data.token)).status, 200);
    assert.equal((await request('/api/expenses?startDate[]=2025-01-01', 'GET', undefined, reLogin.data.token)).status, 400);
    assert.equal((await request('/api/expenses?category[]=Food', 'GET', undefined, reLogin.data.token)).status, 400);
    await request('/api/expenses', 'POST', { title: 'Item 1', amount: 0.1, category: 'Food', date: '2025-06-01T12:00:00.000Z' }, reLogin.data.token);
    await request('/api/expenses', 'POST', { title: 'Item 2', amount: 0.2, category: 'Food', date: '2025-06-02T12:00:00.000Z' }, reLogin.data.token);
    await request('/api/budgets/2025-06', 'PUT', { amount: 100 }, reLogin.data.token);
    await request('/api/budgets/2025-06/categories/Bills', 'PUT', { amount: 50 }, reLogin.data.token);
    const juneBudget = await request('/api/budgets/2025-06', 'GET', undefined, reLogin.data.token);
    assert.equal(juneBudget.data.spent, 0.3);
    assert.equal(juneBudget.data.remaining, 99.7);
    const copyJuly = await request('/api/budgets/2025-07/copy-previous', 'POST', undefined, reLogin.data.token);
    assert.equal(copyJuly.status, 200);
    assert.equal(copyJuly.data.budget, 100);
    assert.equal(copyJuly.data.categories.find(c => c.category === 'Bills').budget, 50);
    assert.equal((await request('/api/budgets/2024-01/copy-previous', 'POST', undefined, reLogin.data.token)).status, 404);
    const todayStr = new Date().toISOString().slice(0, 10);
    const testRecurring = await request('/api/recurring', 'POST', { title: 'Gym', amount: 40, category: 'Healthcare', frequency: 'monthly', startDate: todayStr }, reLogin.data.token);
    const putRecurring = await request(`/api/recurring/${testRecurring.data._id}`, 'PUT', { title: 'Gym Premium', amount: 50, category: 'Healthcare', frequency: 'monthly', startDate: todayStr }, reLogin.data.token);
    assert.equal(putRecurring.status, 200);
    assert.equal(putRecurring.data.title, 'Gym Premium');
    assert.equal(putRecurring.data.nextDate, advance(todayStr, 'monthly', Number(todayStr.slice(8, 10))));
    assert.equal((await request('/api/auth/change-password', 'POST', { currentPassword: 'wrong', newPassword: 'in-app-new-password-123' }, reLogin.data.token)).status, 400);
    assert.equal((await request('/api/auth/change-password', 'POST', { currentPassword: 'new-password-123', newPassword: 'short' }, reLogin.data.token)).status, 400);
    assert.equal((await request('/api/auth/change-password', 'POST', { currentPassword: 'new-password-123', newPassword: 'in-app-new-password-123' })).status, 401);
    const changed = await request('/api/auth/change-password', 'POST', { currentPassword: 'new-password-123', newPassword: 'in-app-new-password-123' }, reLogin.data.token);
    assert.equal(changed.status, 200);
    assert.ok(changed.data.token);
    assert.equal((await request('/api/auth/profile', 'GET', undefined, reLogin.data.token)).status, 401);
    assert.equal((await request('/api/auth/profile', 'GET', undefined, changed.data.token)).status, 200);
    assert.equal((await request('/api/auth/login', 'POST', { email: 'first@example.com', password: 'in-app-new-password-123' })).status, 200);
    assert.equal((await request('/api/auth/profile', 'PATCH', { preferredCurrency: 'USD' })).status, 401);
    assert.equal((await request('/api/auth/profile', 'PATCH', { preferredCurrency: 'INVALID' }, changed.data.token)).status, 400);
    const updatedProfile = await request('/api/auth/profile', 'PATCH', { preferredCurrency: 'USD' }, changed.data.token);
    assert.equal(updatedProfile.status, 200);
    assert.equal(updatedProfile.data.preferredCurrency, 'USD');
    const fetchedProfile = await request('/api/auth/profile', 'GET', undefined, changed.data.token);
    assert.equal(fetchedProfile.data.preferredCurrency, 'USD');
    assert.equal((await request('/api/auth/reset-password', 'POST', { token: resetToken, password: 'again-password-123' })).status, 400);
    assert.equal((await request('/api/auth/forgot-password', 'POST', { email: 'first@example.com' })).status, 200);
    const expiredToken = /#reset=([a-f0-9]{64})/.exec(sentMail[1].text)?.[1];
    await PasswordResetToken.updateOne({ user: first.data.user.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await request('/api/auth/reset-password', 'POST', { token: expiredToken, password: 'again-password-123' })).status, 400);
    delete process.env.SMTP_HOST;
    assert.equal((await request('/api/auth/forgot-password', 'POST', { email: 'first@example.com' })).status, 503);
    process.env.SMTP_HOST = 'smtp.example.test';
    assert.equal((await request('/api/auth/account', 'DELETE')).status, 401);
    await request('/api/expenses', 'POST', { title: 'Coffee', amount: 5, category: 'Food' }, second.data.token);
    await request('/api/budgets/2025-04', 'PUT', { amount: 100 }, second.data.token);
    await request('/api/budgets/2025-04/categories/Food', 'PUT', { amount: 50 }, second.data.token);
    await request('/api/recurring', 'POST', { title: 'Sub', amount: 10, category: 'Entertainment', frequency: 'monthly', startDate: '2025-04-01' }, second.data.token);
    const deleteAccountRes = await request('/api/auth/account', 'DELETE', undefined, second.data.token);
    assert.equal(deleteAccountRes.status, 200);
    assert.equal(await User.findById(second.data.user.id), null);
    assert.equal(await Expense.countDocuments({ user: second.data.user.id }), 0);
    assert.equal(await Budget.countDocuments({ user: second.data.user.id }), 0);
    assert.equal(await CategoryBudget.countDocuments({ user: second.data.user.id }), 0);
    assert.equal(await RecurringExpense.countDocuments({ user: second.data.user.id }), 0);
    assert.equal((await request('/api/auth/profile', 'GET', undefined, second.data.token)).status, 401);
    assert.equal((await request('/api/auth/login', 'POST', { email: 'second@example.com', password: 'password123' })).status, 400);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await new Promise(resolve => server.close(resolve));
  }
});
