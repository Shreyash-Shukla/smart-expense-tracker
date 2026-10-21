const express = require('express');
const mongoose = require('mongoose');
const RecurringExpense = require('../models/RecurringExpense');
const auth = require('../middleware/auth');
const { advance, syncRecurring, syncRecurringMiddleware } = require('../services/recurring');

const router = express.Router();
router.use(auth);

const categories = ['Food', 'Transportation', 'Entertainment', 'Shopping', 'Bills', 'Healthcare', 'Education', 'Other'];

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T12:00:00.000Z`)) &&
    new Date(`${value}T12:00:00.000Z`).toISOString().slice(0, 10) === value;
}

router.get('/', syncRecurringMiddleware, async (req, res) => {
  try {
    res.json(await RecurringExpense.find({ user: req.userId }).sort({ active: -1, startDate: -1 }));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not load recurring expenses' });
  }
});

router.post('/', async (req, res) => {
  const { title, amount, category, description = '', frequency, startDate } = req.body || {};
  const today = new Date();
  const earliest = new Date(today);
  earliest.setUTCFullYear(earliest.getUTCFullYear() - 2);
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 100 ||
      typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1e12 ||
      !categories.includes(category) || typeof description !== 'string' || description.length > 500 ||
      !['daily', 'weekly', 'monthly'].includes(frequency) || !validDate(startDate) ||
      startDate < earliest.toISOString().slice(0, 10)) {
    return res.status(400).json({ message: 'Invalid recurring expense details or start date more than two years ago' });
  }
  try {
    const rule = await RecurringExpense.create({
      user: req.userId, title: title.trim(), amount, category, description, frequency,
      startDate, nextDate: startDate
    });
    await syncRecurring(req.userId);
    res.status(201).json(await RecurringExpense.findById(rule._id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not create recurring expense' });
  }
});

router.patch('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id) || typeof req.body?.active !== 'boolean') {
    return res.status(400).json({ message: 'Invalid recurring expense update' });
  }
  try {
    const rule = await RecurringExpense.findOne({ _id: req.params.id, user: req.userId });
    if (!rule) return res.status(404).json({ message: 'Recurring expense not found' });
    if (req.body.active && !rule.active) {
      const today = new Date().toISOString().slice(0, 10);
      const anchorDay = Number(rule.startDate.slice(8, 10));
      while (rule.nextDate < today) rule.nextDate = advance(rule.nextDate, rule.frequency, anchorDay);
    }
    rule.active = req.body.active;
    await rule.save();
    if (rule.active) await syncRecurring(req.userId);
    res.json(await RecurringExpense.findById(rule._id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not update recurring expense' });
  }
});

router.delete('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid recurring expense ID' });
  try {
    const rule = await RecurringExpense.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!rule) return res.status(404).json({ message: 'Recurring expense not found' });
    res.json({ message: 'Recurring expense removed; existing entries kept' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not remove recurring expense' });
  }
});

module.exports = router;
