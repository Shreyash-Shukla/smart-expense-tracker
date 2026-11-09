const express = require('express');
const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const auth = require('../middleware/auth');
const { syncRecurringMiddleware } = require('../services/recurring');

const router = express.Router();

function periodStartDate(period, endDate = new Date()) {
  const startDate = new Date(endDate);
  if (period === 'week') {
    startDate.setDate(endDate.getDate() - 7);
  } else if (period === 'year') {
    const year = endDate.getFullYear() - 1;
    const month = endDate.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    startDate.setFullYear(year, month, Math.min(endDate.getDate(), lastDay));
  } else {
    const year = endDate.getFullYear();
    const month = endDate.getMonth() - 1;
    const lastDay = new Date(year, month + 1, 0).getDate();
    startDate.setFullYear(year, month, Math.min(endDate.getDate(), lastDay));
  }
  return startDate;
}

// Get dashboard statistics
router.get('/stats', auth, syncRecurringMiddleware, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.userId);
    const period = typeof req.query.period === 'string' && ['week', 'month', 'year'].includes(req.query.period)
      ? req.query.period : 'month';

    const endDate = new Date();
    const startDate = periodStartDate(period, endDate);

    // Keep currencies separate; older entries without a currency are INR.
    const totalsByCurrency = (await Expense.aggregate([
      { $match: { user: userId, date: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: { $ifNull: ['$currency', 'INR'] }, total: { $sum: '$amount' } } },
      { $sort: { _id: 1 } }
    ])).map(item => ({ ...item, total: Math.round(item.total * 100) / 100 }));

    // Expenses by category
    const expensesByCategory = (await Expense.aggregate([
      { $match: { user: userId, date: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: { category: '$category', currency: { $ifNull: ['$currency', 'INR'] } },
        total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } }
    ])).map(item => ({ ...item, total: Math.round(item.total * 100) / 100 }));

    // Daily expenses for chart
    const dailyExpenses = (await Expense.aggregate([
      { $match: { user: userId, date: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
            currency: { $ifNull: ['$currency', 'INR'] } },
          total: { $sum: '$amount' }
        }
      },
      { $sort: { '_id.date': 1, '_id.currency': 1 } }
    ])).map(item => ({ ...item, total: Math.round(item.total * 100) / 100 }));

    // Recent expenses
    const recentExpenses = await Expense.find({ user: userId })
      .sort({ date: -1 })
      .limit(5);

    const inrTotal = totalsByCurrency.find(item => item._id === 'INR')?.total || 0;

    res.json({
      totalExpenses: inrTotal,
      totalExpensesCurrency: 'INR',
      totalsByCurrency,
      expensesByCategory,
      dailyExpenses,
      recentExpenses
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get category breakdown
router.get('/categories', auth, syncRecurringMiddleware, async (req, res) => {
  try {
    const period = typeof req.query.period === 'string' && ['week', 'month', 'year'].includes(req.query.period)
      ? req.query.period : 'month';
    const userId = new mongoose.Types.ObjectId(req.userId);

    const endDate = new Date();
    const startDate = periodStartDate(period, endDate);

    const categoryBreakdown = (await Expense.aggregate([
      { $match: { user: userId, date: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: { category: '$category', currency: { $ifNull: ['$currency', 'INR'] } },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
          average: { $avg: '$amount' }
        }
      },
      { $sort: { total: -1 } }
    ])).map(item => ({
      ...item,
      total: Math.round(item.total * 100) / 100,
      average: Math.round(item.average * 100) / 100
    }));

    res.json(categoryBreakdown);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.periodStartDate = periodStartDate;
module.exports = router;
