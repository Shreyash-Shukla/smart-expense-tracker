const express = require('express');
const mongoose = require('mongoose');
const Budget = require('../models/Budget');
const CategoryBudget = require('../models/CategoryBudget');
const Expense = require('../models/Expense');
const auth = require('../middleware/auth');
const { syncRecurringMiddleware } = require('../services/recurring');
const { currencies } = require('../config/currencies');
const { categories } = require('../config/categories');

const router = express.Router();
router.use(auth);

function validMonth(month) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

function budgetAlert(scope, category, budget, spent) {
  if (budget === null) return null;
  const budgetCents = Math.round(budget * 100);
  const spentCents = Math.round(spent * 100);
  if (spentCents * 5 < budgetCents * 4) return null;
  return { scope, ...(category ? { category } : {}),
    level: spentCents > budgetCents ? 'over' : spentCents === budgetCents ? 'reached' : 'near',
    budget, spent, remaining: (budgetCents - spentCents) / 100 };
}

async function summary(user, month, currency) {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const match = { user: new mongoose.Types.ObjectId(user), date: { $gte: start, $lt: end },
    currency: currency === 'INR' ? { $in: ['INR', null] } : currency };
  const [budget, expenses, categoryBudgets, categorySpending] = await Promise.all([
    Budget.findOne({ user, month }),
    Expense.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]),
    CategoryBudget.find({ user, month, currency }).lean(),
    Expense.aggregate([
      { $match: match },
      { $group: { _id: '$category', total: { $sum: '$amount' } } }
    ])
  ]);
  const spent = Math.round((expenses[0]?.total || 0) * 100) / 100;
  const amount = currency === 'INR' ? budget?.amount ?? null : budget?.otherAmounts?.get(currency) ?? null;
  const limits = new Map(categoryBudgets.map(item => [item.category, item.amount]));
  const spending = new Map(categorySpending.map(item => [item._id, item.total]));
  const categorySummaries = categories.map(category => {
    const budget = limits.get(category) ?? null;
    const spent = Math.round((spending.get(category) || 0) * 100) / 100;
    return { category, budget, spent, remaining: budget === null ? null : (Math.round(budget * 100) - Math.round(spent * 100)) / 100 };
  });
  const alerts = [budgetAlert('overall', null, amount, spent),
    ...categorySummaries.map(item => budgetAlert('category', item.category, item.budget, item.spent))]
    .filter(Boolean);
  return { month, currency, budget: amount, spent, remaining: amount === null ? null : (Math.round(amount * 100) - Math.round(spent * 100)) / 100,
    categories: categorySummaries, alerts };
}

router.param('month', (req, res, next, month) => {
  if (!validMonth(month)) return res.status(400).json({ message: 'Invalid month' });
  next();
});

router.use('/:month', (req, res, next) => {
  req.currency = req.query.currency || 'INR';
  if (!currencies.includes(req.currency)) return res.status(400).json({ message: 'Invalid currency' });
  next();
});

router.get('/:month', syncRecurringMiddleware, async (req, res) => {
  try {
    res.json(await summary(req.userId, req.params.month, req.currency));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not load budget' });
  }
});

router.put('/:month/categories/:category', async (req, res) => {
  if (!categories.includes(req.params.category)) return res.status(400).json({ message: 'Invalid category' });
  const amount = req.body?.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1e12 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) {
    return res.status(400).json({ message: 'Enter a positive category limit with up to two decimal places' });
  }
  try {
    const filter = { user: req.userId, month: req.params.month, currency: req.currency, category: req.params.category };
    const update = { $set: { amount: Math.round(amount * 100) / 100 } };
    try {
      await CategoryBudget.findOneAndUpdate(filter, update, { upsert: true, runValidators: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
      await CategoryBudget.updateOne(filter, update, { runValidators: true });
    }
    res.json(await summary(req.userId, req.params.month, req.currency));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not save category limit' });
  }
});

router.delete('/:month/categories/:category', async (req, res) => {
  if (!categories.includes(req.params.category)) return res.status(400).json({ message: 'Invalid category' });
  try {
    await CategoryBudget.deleteOne({ user: req.userId, month: req.params.month,
      currency: req.currency, category: req.params.category });
    res.json(await summary(req.userId, req.params.month, req.currency));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not clear category limit' });
  }
});

router.put('/:month', async (req, res) => {
  const amount = req.body?.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1e12 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) {
    return res.status(400).json({ message: 'Enter a positive budget amount with up to two decimal places' });
  }
  try {
    const field = req.currency === 'INR' ? 'amount' : `otherAmounts.${req.currency}`;
    const filter = { user: req.userId, month: req.params.month };
    const update = { $set: { [field]: Math.round(amount * 100) / 100 } };
    try {
      await Budget.findOneAndUpdate(filter, update, { upsert: true, runValidators: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
      await Budget.updateOne(filter, update, { runValidators: true });
    }
    res.json(await summary(req.userId, req.params.month, req.currency));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not save budget' });
  }
});

router.delete('/:month', async (req, res) => {
  try {
    const field = req.currency === 'INR' ? 'amount' : `otherAmounts.${req.currency}`;
    await Budget.updateOne({ user: req.userId, month: req.params.month }, { $unset: { [field]: '' } });
    res.json(await summary(req.userId, req.params.month, req.currency));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not clear budget' });
  }
});

module.exports = router;
