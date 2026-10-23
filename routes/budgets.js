const express = require('express');
const mongoose = require('mongoose');
const Budget = require('../models/Budget');
const Expense = require('../models/Expense');
const auth = require('../middleware/auth');
const { syncRecurringMiddleware } = require('../services/recurring');
const { currencies } = require('../config/currencies');

const router = express.Router();
router.use(auth);

function validMonth(month) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

async function summary(user, month, currency) {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const match = { user: new mongoose.Types.ObjectId(user), date: { $gte: start, $lt: end },
    currency: currency === 'INR' ? { $in: ['INR', null] } : currency };
  const [budget, expenses] = await Promise.all([
    Budget.findOne({ user, month }),
    Expense.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ])
  ]);
  const spent = expenses[0]?.total || 0;
  const amount = currency === 'INR' ? budget?.amount ?? null : budget?.otherAmounts?.get(currency) ?? null;
  return { month, currency, budget: amount, spent, remaining: amount === null ? null : amount - spent };
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
