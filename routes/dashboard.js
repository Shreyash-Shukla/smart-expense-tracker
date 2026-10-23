const express = require('express');
const mongoose = require('mongoose');
const Expense = require('../models/Expense');
const auth = require('../middleware/auth');
const { syncRecurringMiddleware } = require('../services/recurring');

const router = express.Router();

// Get dashboard statistics
router.get('/stats', auth, syncRecurringMiddleware, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.userId);
    const { period = 'month' } = req.query;

    let startDate;
    const endDate = new Date();

    switch (period) {
      case 'week':
        startDate = new Date();
        startDate.setDate(endDate.getDate() - 7);
        break;
      case 'month':
        startDate = new Date();
        startDate.setMonth(endDate.getMonth() - 1);
        break;
      case 'year':
        startDate = new Date();
        startDate.setFullYear(endDate.getFullYear() - 1);
        break;
      default:
        startDate = new Date();
        startDate.setMonth(endDate.getMonth() - 1);
    }

    // Keep currencies separate; older entries without a currency are INR.
    const totalsByCurrency = await Expense.aggregate([
      { $match: { user: userId, date: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: { $ifNull: ['$currency', 'INR'] }, total: { $sum: '$amount' } } },
      { $sort: { _id: 1 } }
    ]);

    // Expenses by category
    const expensesByCategory = await Expense.aggregate([
      { $match: { user: userId, date: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: { category: '$category', currency: { $ifNull: ['$currency', 'INR'] } },
        total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } }
    ]);

    // Daily expenses for chart
    const dailyExpenses = await Expense.aggregate([
      { $match: { user: userId, date: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
            currency: { $ifNull: ['$currency', 'INR'] } },
          total: { $sum: '$amount' }
        }
      },
      { $sort: { '_id.date': 1, '_id.currency': 1 } }
    ]);

    // Recent expenses
    const recentExpenses = await Expense.find({ user: userId })
      .sort({ date: -1 })
      .limit(5);

    res.json({
      totalExpenses: totalsByCurrency.find(item => item._id === 'INR')?.total || 0,
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
    const { period = 'month' } = req.query;
    const userId = new mongoose.Types.ObjectId(req.userId);

    let startDate;
    const endDate = new Date();

    switch (period) {
      case 'week':
        startDate = new Date();
        startDate.setDate(endDate.getDate() - 7);
        break;
      case 'month':
        startDate = new Date();
        startDate.setMonth(endDate.getMonth() - 1);
        break;
      case 'year':
        startDate = new Date();
        startDate.setFullYear(endDate.getFullYear() - 1);
        break;
      default:
        startDate = new Date();
        startDate.setMonth(endDate.getMonth() - 1);
    }

    const categoryBreakdown = await Expense.aggregate([
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
    ]);

    res.json(categoryBreakdown);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
