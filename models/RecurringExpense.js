const mongoose = require('mongoose');

const recurringExpenseSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true, maxlength: 100 },
  amount: { type: Number, required: true, min: 0 },
  category: { type: String, required: true, enum: ['Food', 'Transportation', 'Entertainment', 'Shopping', 'Bills', 'Healthcare', 'Education', 'Other'] },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  frequency: { type: String, required: true, enum: ['daily', 'weekly', 'monthly'] },
  startDate: { type: String, required: true },
  nextDate: { type: String, required: true },
  active: { type: Boolean, default: true }
});

recurringExpenseSchema.index({ user: 1, active: 1 });

module.exports = mongoose.model('RecurringExpense', recurringExpenseSchema);
