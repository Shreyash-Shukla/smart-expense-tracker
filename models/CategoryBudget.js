const mongoose = require('mongoose');
const { currencies } = require('../config/currencies');
const { categories } = require('../config/categories');

const categoryBudgetSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  currency: { type: String, required: true, enum: currencies },
  category: { type: String, required: true, enum: categories },
  amount: { type: Number, required: true, min: 0.01 }
});

categoryBudgetSchema.index({ user: 1, month: 1, currency: 1, category: 1 }, { unique: true });

module.exports = mongoose.model('CategoryBudget', categoryBudgetSchema);
