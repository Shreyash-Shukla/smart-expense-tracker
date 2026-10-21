const express = require('express');
const mongoose = require('mongoose');
const Budget = require('../models/Budget');
const Expense = require('../models/Expense');
const auth = require('../middleware/auth');
const { syncRecurringMiddleware } = require('../services/recurring');

const router = express.Router();
router.use(auth);

function validMonth(month) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

async function summary(user, month) {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const [budget, expenses] = await Promise.all([
    Budget.findOne({ user, month }),
    Expense.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(user), date: { $gte: start, $lt: end } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ])
  ]);
  const spent = expenses[0]?.total || 0;
  return { month, budget: budget?.amount ?? null, spent, remaining: budget ? budget.amount - spent : null };
}

router.param('month', (req, res, next, month) => {
  if (!validMonth(month)) return res.status(400).json({ message: 'Invalid month' });
  next();
});

router.get('/:month', syncRecurringMiddleware, async (req, res) => {
  try {
    res.json(await summary(req.userId, req.params.month));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not load budget' });
  }
});

router.put('/:month', async (req, res) => {
  const amount = req.body?.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1e12 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) {
    return res.status(400).json({ message: 'Enter a positive budget amount with up to two decimal places' });
  }
  try {
    await Budget.findOneAndUpdate(
      { user: req.userId, month: req.params.month },
      { $set: { amount: Math.round(amount * 100) / 100 } },
      { upsert: true, runValidators: true }
    );
    res.json(await summary(req.userId, req.params.month));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not save budget' });
  }
});

router.delete('/:month', async (req, res) => {
  try {
    await Budget.findOneAndDelete({ user: req.userId, month: req.params.month });
    res.json(await summary(req.userId, req.params.month));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not clear budget' });
  }
});

module.exports = router;
