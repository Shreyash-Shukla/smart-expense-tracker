const mongoose = require('mongoose');
const { currencies } = require('../config/currencies');

const expenseSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: { type: String, enum: currencies, default: 'INR' },
  category: {
    type: String,
    required: true,
    enum: ['Food', 'Transportation', 'Entertainment', 'Shopping', 'Bills', 'Healthcare', 'Education', 'Other']
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  date: {
    type: Date,
    default: Date.now
  },
  recurringRule: { type: mongoose.Schema.Types.ObjectId, ref: 'RecurringExpense' },
  occurrenceDate: { type: String },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

expenseSchema.index(
  { recurringRule: 1, occurrenceDate: 1 },
  { unique: true, partialFilterExpression: { recurringRule: { $exists: true } } }
);

module.exports = mongoose.model('Expense', expenseSchema);
