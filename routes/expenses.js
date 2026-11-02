const express = require('express');
const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const auth = require('../middleware/auth');
const { syncRecurringMiddleware } = require('../services/recurring');
const { currencies } = require('../config/currencies');
const { categories } = require('../config/categories');

const router = express.Router();

function expenseInput(body) {
  const { title, amount, currency, category, description, date } = body;
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 100 ||
      typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1e12 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8 ||
      (currency !== undefined && !currencies.includes(currency)) ||
      !categories.includes(category) ||
      (description !== undefined && (typeof description !== 'string' || description.length > 500)) ||
      (date !== undefined && (typeof date !== 'string' || Number.isNaN(Date.parse(date))))) {
    return null;
  }
  return { title: title.trim(), amount: Math.round(amount * 100) / 100, ...(currency === undefined ? {} : { currency }), category,
    description: description || '', date: date ? new Date(date) : new Date() };
}

function expenseFilter(query, userId) {
  const { category, currency, startDate, endDate, search } = query;
  if ((category && !categories.includes(category)) || (currency && !currencies.includes(currency)) ||
      (startDate && Number.isNaN(Date.parse(startDate))) || (endDate && Number.isNaN(Date.parse(endDate))) ||
      (startDate && endDate && new Date(startDate) > new Date(endDate)) ||
      (search !== undefined && (typeof search !== 'string' || search.trim().length > 100))) return null;
  const filter = { user: userId };
  if (category) filter.category = category;
  if (currency) filter.currency = currency === 'INR' ? { $in: ['INR', null] } : currency;
  if (search?.trim()) {
    const literal = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ title: { $regex: literal, $options: 'i' } },
      { description: { $regex: literal, $options: 'i' } }];
  }
  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = new Date(startDate);
    if (endDate) filter.date.$lte = new Date(endDate);
  }
  return filter;
}

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

router.get('/export.csv', auth, syncRecurringMiddleware, async (req, res) => {
  const filter = expenseFilter(req.query, req.userId);
  if (!filter) return res.status(400).json({ message: 'Invalid filters' });
  try {
    const expenses = await Expense.find(filter).sort({ date: -1, _id: -1 }).lean();
    const rows = [['Date', 'Title', 'Category', 'Amount', 'Currency', 'Note', 'Recurring'],
      ...expenses.map(item => [item.date.toISOString().slice(0, 10), item.title, item.category,
        item.amount.toFixed(2), item.currency || 'INR', item.description || '', item.recurringRule ? 'Yes' : 'No'])];
    res.type('text/csv').set('Content-Disposition', 'attachment; filename="expenses.csv"')
      .send(`\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not export expenses' });
  }
});

// Get all expenses for a user
router.get('/', auth, syncRecurringMiddleware, async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);
    const filter = expenseFilter(req.query, req.userId);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100 || !filter) {
      return res.status(400).json({ message: 'Invalid filters' });
    }

    const expenses = await Expense.find(filter)
      .sort({ date: -1, _id: -1 })
      .limit(limit)
      .skip((page - 1) * limit);

    const total = await Expense.countDocuments(filter);

    res.json({
      expenses,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not load expenses' });
  }
});

// Create new expense
router.post('/', auth, async (req, res) => {
  try {
    const input = expenseInput(req.body || {});
    if (!input) return res.status(400).json({ message: 'Invalid expense details' });
    const expense = new Expense({ user: req.userId, ...input });

    await expense.save();
    res.status(201).json(expense);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not create expense' });
  }
});

// Update expense
router.put('/:id', auth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid expense ID' });
  try {
    const input = expenseInput(req.body || {});
    if (!input) return res.status(400).json({ message: 'Invalid expense details' });
    const expense = await Expense.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { $set: input },
      { new: true, runValidators: true }
    );

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    res.json(expense);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not update expense' });
  }
});

// Delete expense
router.delete('/:id', auth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid expense ID' });
  try {
    const expense = await Expense.findOneAndDelete({ _id: req.params.id, user: req.userId });

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not delete expense' });
  }
});

// Get expense by ID
router.get('/:id', auth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid expense ID' });
  try {
    const expense = await Expense.findOne({ _id: req.params.id, user: req.userId });

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    res.json(expense);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not load expense' });
  }
});

module.exports = router;
