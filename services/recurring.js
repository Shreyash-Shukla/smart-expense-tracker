const Expense = require('../models/Expense');
const RecurringExpense = require('../models/RecurringExpense');

function advance(dateString, frequency, anchorDay) {
  const date = new Date(`${dateString}T12:00:00.000Z`);
  if (frequency === 'daily') date.setUTCDate(date.getUTCDate() + 1);
  if (frequency === 'weekly') date.setUTCDate(date.getUTCDate() + 7);
  if (frequency === 'monthly') {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    date.setUTCFullYear(year, month, Math.min(anchorDay, lastDay));
  }
  return date.toISOString().slice(0, 10);
}

async function syncRecurring(userId) {
  await Expense.init();
  const today = new Date().toISOString().slice(0, 10);
  const rules = await RecurringExpense.find({ user: userId, active: true });
  for (const rule of rules) {
    let nextDate = rule.nextDate;
    let generated = 0;
    const anchorDay = Number(rule.startDate.slice(8, 10));
    while (nextDate <= today && generated < 1000) {
      const occurrenceDate = nextDate;
      try {
        await Expense.updateOne(
          { recurringRule: rule._id, occurrenceDate },
          { $setOnInsert: {
            user: rule.user, title: rule.title, amount: rule.amount, currency: rule.currency || 'INR', category: rule.category,
            description: rule.description, date: new Date(`${occurrenceDate}T12:00:00.000Z`),
            recurringRule: rule._id, occurrenceDate
          } },
          { upsert: true }
        );
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
      nextDate = advance(nextDate, rule.frequency, anchorDay);
      generated++;
    }
    if (nextDate !== rule.nextDate) {
      await RecurringExpense.updateOne({ _id: rule._id, nextDate: rule.nextDate, active: true }, { $set: { nextDate } });
    }
  }
}

async function syncRecurringMiddleware(req, res, next) {
  try {
    await syncRecurring(req.userId);
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { advance, syncRecurring, syncRecurringMiddleware };
