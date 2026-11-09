const $ = id => document.getElementById(id);
const currencyNames = { INR: 'Indian rupee', USD: 'US dollar', EUR: 'Euro', GBP: 'British pound',
  CAD: 'Canadian dollar', AUD: 'Australian dollar', SGD: 'Singapore dollar',
  AED: 'UAE dirham', CHF: 'Swiss franc' };
const money = (value, currency = 'INR') => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency, currencyDisplay: currency === 'INR' ? 'symbol' : 'code'
}).format(value);
let token = localStorage.getItem('expense-token');
let user = null;
let page = 1;
let totalPages = 1;
let authMode = 'login';
let resetToken = new URLSearchParams(location.hash.slice(1)).get('reset');
let editingId = null;
let editingRecurringId = null;
let filters = { search: '', category: '', currency: '', startDate: '', endDate: '', sort: 'date_desc' };
let listRequestId = 0;
let statsRequestId = 0;
let budgetRequestId = 0;
let recurringRequestId = 0;
let budgetData = null;

function showError(id, message) {
  $(id).textContent = message || '';
  $(id).hidden = !message;
}

function applyCurrencyPreference(curr) {
  const c = curr || user?.preferredCurrency || 'INR';
  $('expense-currency').value = c;
  $('recurring-currency').value = c;
  $('budget-currency').value = c;
  $('preferred-currency').value = c;
}

function showView(signedIn) {
  $('auth-view').hidden = signedIn;
  $('dashboard-view').hidden = !signedIn;
  $('logout').hidden = !signedIn;
  if (signedIn) {
    $('greeting').textContent = `Hi, ${user.username}`;
    applyCurrencyPreference(user.preferredCurrency);
  }
}

function signOut() {
  listRequestId++;
  statsRequestId++;
  resetExpenseForm();
  $('filter-form').reset();
  filters = { search: '', category: '', currency: '', startDate: '', endDate: '', sort: 'date_desc' };
  budgetRequestId++;
  $('budget-form').reset();
  setCurrentMonth();
  $('budget-currency').value = 'INR';
  $('budget-status').textContent = '';
  $('budget-progress').hidden = true;
  $('budget-alerts').replaceChildren();
  $('budget-alerts').hidden = true;
  budgetData = null;
  $('category-budget-form').reset();
  $('category-budget-list').replaceChildren();
  $('category-budget-clear').hidden = true;
  showError('category-budget-error', '');
  recurringRequestId++;
  resetRecurringForm();
  $('recurring-list').replaceChildren();
  $('insights-list').replaceChildren();
  $('expense-list').replaceChildren();
  $('history-summary').textContent = '';
  $('history-summary').hidden = true;
  $('expense-count').textContent = '0';
  $('expense-count-label').textContent = 'Recorded expenses';
  $('month-total').replaceChildren();
  const initialTotal = document.createElement('span');
  initialTotal.className = 'currency-total';
  initialTotal.textContent = '₹0.00';
  $('month-total').append(initialTotal);
  showError('list-error', '');
  showError('budget-error', '');
  $('change-password-form').reset();
  showError('account-error', '');
  showError('account-message', '');
  $('currency-preference-form').reset();
  showError('currency-error', '');
  showError('currency-message', '');
  showError('delete-account-error', '');
  token = null;
  user = null;
  localStorage.removeItem('expense-token');
  showView(false);
}

function localDate(date) {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function expenseDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function resetExpenseForm() {
  editingId = null;
  $('expense-form').reset();
  setToday();
  $('expense-currency').value = user?.preferredCurrency || 'INR';
  $('add-heading').textContent = 'Add an expense';
  $('expense-submit').textContent = 'Save expense';
  $('cancel-edit').hidden = true;
  showError('expense-error', '');
}

function resetRecurringForm() {
  editingRecurringId = null;
  $('recurring-form').reset();
  setRecurringToday();
  $('recurring-currency').value = user?.preferredCurrency || 'INR';
  $('recurring-save').textContent = 'Add schedule';
  $('recurring-cancel').hidden = true;
  showError('recurring-error', '');
}

function editRecurring(rule) {
  editingRecurringId = rule._id;
  $('recurring-title').value = rule.title;
  $('recurring-amount').value = rule.amount;
  $('recurring-currency').value = rule.currency || 'INR';
  $('recurring-category').value = rule.category;
  $('recurring-frequency').value = rule.frequency;
  $('recurring-start').value = rule.startDate;
  $('recurring-description').value = rule.description || '';
  $('recurring-save').textContent = 'Update schedule';
  $('recurring-cancel').hidden = false;
  showError('recurring-error', '');
  $('recurring-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('recurring-title').focus({ preventScroll: true });
}

function editExpense(expense) {
  editingId = expense._id;
  $('expense-title').value = expense.title;
  $('expense-amount').value = expense.amount;
  $('expense-currency').value = expense.currency || 'INR';
  $('expense-date').value = expenseDate(expense.date);
  $('expense-category').value = expense.category;
  $('expense-description').value = expense.description || '';
  $('add-heading').textContent = 'Edit expense';
  $('expense-submit').textContent = 'Update expense';
  $('cancel-edit').hidden = false;
  showError('expense-error', '');
  $('expense-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('expense-title').focus({ preventScroll: true });
}

function duplicateExpense(expense) {
  resetExpenseForm();
  $('expense-title').value = expense.title;
  $('expense-amount').value = expense.amount;
  $('expense-currency').value = expense.currency || 'INR';
  setToday();
  $('expense-category').value = expense.category;
  $('expense-description').value = expense.description || '';
  $('add-heading').textContent = 'Add an expense (copy)';
  $('expense-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('expense-amount').focus({ preventScroll: true });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.includes('/auth/login')) signOut();
    throw new Error(data.message || 'Something went wrong. Please try again.');
  }
  return data;
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === 'register';
  $('auth-tabs').hidden = false;
  $('auth-form').hidden = false;
  $('forgot-form').hidden = true;
  $('reset-form').hidden = true;
  $('forgot-password').hidden = registering;
  $('back-to-login').hidden = true;
  $('username-field').hidden = !registering;
  $('username').required = registering;
  $('password').autocomplete = registering ? 'new-password' : 'current-password';
  $('auth-title').textContent = registering ? 'Create your account' : 'Welcome back';
  $('auth-submit').textContent = registering ? 'Create account' : 'Log in';
  $('login-tab').classList.toggle('active', !registering);
  $('register-tab').classList.toggle('active', registering);
  $('login-tab').setAttribute('aria-selected', String(!registering));
  $('register-tab').setAttribute('aria-selected', String(registering));
  showError('auth-error', '');
  showError('auth-message', '');
}

function showRecovery(mode) {
  authMode = mode;
  $('auth-tabs').hidden = true;
  $('auth-form').hidden = true;
  $('forgot-password').hidden = true;
  $('forgot-form').hidden = mode !== 'forgot';
  $('reset-form').hidden = mode !== 'reset';
  $('back-to-login').hidden = false;
  $('auth-title').textContent = mode === 'forgot' ? 'Reset your password' : 'Choose a new password';
  showError('auth-message', '');
  showError('forgot-error', '');
  showError('forgot-message', '');
  showError('reset-error', '');
}

async function loadStats() {
  const requestId = ++statsRequestId;
  const period = $('insights-period').value;
  const stats = await api(`/api/dashboard/stats?period=${period}`);
  if (requestId !== statsRequestId || period !== $('insights-period').value) return;
  $('month-total').previousElementSibling.textContent = `Spending over the past ${period}, by currency`;
  const total = $('month-total');
  total.replaceChildren();
  const entries = stats.totalsByCurrency.length ? stats.totalsByCurrency : [{ _id: 'INR', total: 0 }];
  for (const entry of entries) {
    const line = document.createElement('span');
    line.className = 'currency-total';
    line.textContent = money(entry.total, entry._id);
    total.append(line);
  }
  renderInsights(stats, period);
}

function insightBar(label, value, max, currency) {
  const row = document.createElement('div');
  row.className = 'insight-row';
  const heading = document.createElement('div');
  heading.className = 'insight-row-heading';
  const name = document.createElement('span');
  name.textContent = label;
  const amount = document.createElement('strong');
  amount.textContent = money(value, currency);
  heading.append(name, amount);
  const track = document.createElement('div');
  track.className = 'insight-track';
  const fill = document.createElement('span');
  fill.style.width = `${max ? value / max * 100 : 0}%`;
  track.append(fill);
  row.append(heading, track);
  return row;
}

function trendBucket(date, period) {
  if (period === 'year') return date.slice(0, 7);
  if (period === 'week') return date;
  const day = new Date(`${date}T12:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() - day.getUTCDay());
  return day.toISOString().slice(0, 10);
}

function renderInsights(stats, period) {
  const list = $('insights-list');
  list.replaceChildren();
  if (!stats.totalsByCurrency.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Add expenses to see your spending patterns.';
    list.append(empty);
    return;
  }
  for (const total of stats.totalsByCurrency) {
    const currency = total._id;
    const section = document.createElement('section');
    section.className = 'insight-currency';
    const heading = document.createElement('h3');
    heading.textContent = `${currency} · ${money(total.total, currency)}`;
    section.append(heading);
    const columns = document.createElement('div');
    columns.className = 'insight-columns';
    const categories = document.createElement('div');
    const categoryHeading = document.createElement('h4');
    categoryHeading.textContent = 'By category';
    categories.append(categoryHeading);
    const categoryEntries = stats.expensesByCategory.filter(item => item._id.currency === currency)
      .sort((a, b) => b.total - a.total);
    const categoryMax = Math.max(...categoryEntries.map(item => item.total), 0);
    for (const item of categoryEntries) categories.append(insightBar(item._id.category, item.total, categoryMax, currency));
    const trend = document.createElement('div');
    const trendHeading = document.createElement('h4');
    trendHeading.textContent = period === 'year' ? 'By month' : period === 'week' ? 'By day' : 'By week';
    trend.append(trendHeading);
    const buckets = new Map();
    for (const item of stats.dailyExpenses.filter(item => item._id.currency === currency)) {
      const key = trendBucket(item._id.date, period);
      buckets.set(key, (buckets.get(key) || 0) + item.total);
    }
    const trendMax = Math.max(...buckets.values(), 0);
    for (const [date, value] of buckets) {
      const label = period === 'year'
        ? new Date(`${date}-01T12:00:00.000Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })
        : new Date(`${date}T12:00:00.000Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
      trend.append(insightBar(label, value, trendMax, currency));
    }
    columns.append(categories, trend);
    section.append(columns);
    list.append(section);
  }
}

function renderBudget(data) {
  budgetData = data;
  $('budget-amount').value = data.budget ?? '';
  $('budget-clear').hidden = data.budget === null;
  const progress = $('budget-progress');
  progress.hidden = data.budget === null;
  if (data.budget === null) {
    $('budget-status').textContent = `${money(data.spent, data.currency)} spent in the selected month. Set a budget to track what remains.`;
  } else {
    const percent = Math.round(data.spent / data.budget * 100);
    progress.setAttribute('aria-valuenow', String(Math.min(percent, 100)));
    progress.setAttribute('aria-valuetext', `${percent}% of budget used`);
    progress.classList.toggle('over', data.remaining < 0);
    $('budget-progress-fill').style.width = `${Math.min(percent, 100)}%`;
    $('budget-status').textContent = data.remaining >= 0
      ? `${money(data.spent, data.currency)} spent of ${money(data.budget, data.currency)} · ${money(data.remaining, data.currency)} left`
      : `${money(data.spent, data.currency)} spent of ${money(data.budget, data.currency)} · ${money(-data.remaining, data.currency)} over budget`;
  }
  const alerts = $('budget-alerts');
  alerts.replaceChildren();
  alerts.hidden = data.alerts.length === 0;
  if (data.alerts.length) {
    const heading = document.createElement('h3');
    heading.textContent = 'Budget warnings';
    const list = document.createElement('ul');
    for (const alert of data.alerts) {
      const item = document.createElement('li');
      item.className = `budget-alert ${alert.level}`;
      const label = alert.scope === 'overall' ? 'Monthly budget' : `${alert.category} limit`;
      item.textContent = alert.level === 'over'
        ? `${label}: ${money(-alert.remaining, data.currency)} over the ${money(alert.budget, data.currency)} limit.`
        : alert.level === 'reached'
          ? `${label}: ${money(alert.budget, data.currency)} limit reached.`
          : `${label}: ${Math.round(alert.spent / alert.budget * 100)}% used · ${money(alert.remaining, data.currency)} left.`;
      list.append(item);
    }
    alerts.append(heading, list);
  }
  const list = $('category-budget-list');
  list.replaceChildren();
  for (const item of data.categories) {
    const row = document.createElement('div');
    row.className = 'category-budget-item';
    const label = document.createElement('span');
    label.textContent = item.category;
    const detail = document.createElement('span');
    detail.textContent = item.budget === null
      ? `${money(item.spent, data.currency)} spent · No limit`
      : `${money(item.spent, data.currency)} of ${money(item.budget, data.currency)} · ${item.remaining >= 0 ? `${money(item.remaining, data.currency)} left` : `${money(-item.remaining, data.currency)} over`}`;
    if (item.remaining < 0) detail.className = 'over-budget';
    row.append(label, detail);
    list.append(row);
  }
  selectCategoryBudget();
}

function selectCategoryBudget() {
  const selected = budgetData?.categories.find(item => item.category === $('category-budget-category').value);
  $('category-budget-amount').value = selected?.budget ?? '';
  $('category-budget-clear').hidden = selected?.budget == null;
}

async function loadBudget() {
  const month = $('budget-month').value;
  const currency = $('budget-currency').value;
  const requestId = ++budgetRequestId;
  const data = await api(`/api/budgets/${month}?currency=${currency}`);
  if (requestId === budgetRequestId && month === $('budget-month').value && currency === $('budget-currency').value) renderBudget(data);
}

async function loadRecurring() {
  const requestId = ++recurringRequestId;
  const rules = await api('/api/recurring');
  if (requestId !== recurringRequestId) return;
  const list = $('recurring-list');
  list.replaceChildren();
  if (rules.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No recurring expenses yet.';
    list.append(empty);
  }
  for (const rule of rules) {
    const row = document.createElement('div');
    row.className = 'recurring-item';
    const details = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `${rule.title} · ${money(rule.amount, rule.currency || 'INR')}`;
    const meta = document.createElement('small');
    meta.className = 'recurring-meta';
    const badge = document.createElement('span');
    badge.className = 'category-badge';
    badge.textContent = rule.category;
    meta.append(badge, ` · ${rule.frequency} · ${rule.active ? `Next: ${rule.nextDate}` : 'Paused'}`);
    details.append(title, meta);
    const actions = document.createElement('div');
    actions.className = 'recurring-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.setAttribute('aria-label', `Edit ${rule.title} schedule`);
    edit.addEventListener('click', () => editRecurring(rule));
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = rule.active ? 'Pause' : 'Resume';
    toggle.setAttribute('aria-label', `${toggle.textContent} ${rule.title}`);
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      try {
        await api(`/api/recurring/${rule._id}`, { method: 'PATCH', body: JSON.stringify({ active: !rule.active }) });
        await refresh();
      } catch (error) {
        showError('recurring-error', error.message);
        toggle.disabled = false;
      }
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete-button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${rule.title} schedule`);
    remove.addEventListener('click', async () => {
      if (!confirm(`Remove the schedule for "${rule.title}"? Existing expense entries will stay.`)) return;
      remove.disabled = true;
      try {
        await api(`/api/recurring/${rule._id}`, { method: 'DELETE' });
        if (editingRecurringId === rule._id) resetRecurringForm();
        await refresh();
      } catch (error) {
        showError('recurring-error', error.message);
        remove.disabled = false;
      }
    });
    actions.append(edit, toggle, remove);
    row.append(details, actions);
    list.append(row);
  }
}

function expenseRow(expense) {
  const row = document.createElement('div');
  row.className = 'expense-item';
  const main = document.createElement('div');
  main.className = 'expense-main';
  const title = document.createElement('div');
  title.className = 'expense-title';
  title.textContent = expense.title;
  const meta = document.createElement('div');
  meta.className = 'expense-meta';
  const badge = document.createElement('span');
  badge.className = 'category-badge';
  badge.textContent = expense.category;
  meta.append(badge, ` · ${new Date(expense.date).toLocaleDateString(undefined, { timeZone: 'UTC' })}${expense.recurringRule ? ' · Recurring' : ''}`);
  main.append(title, meta);
  if (expense.description) {
    const note = document.createElement('p');
    note.className = 'expense-note';
    note.textContent = expense.description;
    main.append(note);
  }
  const side = document.createElement('div');
  side.className = 'expense-side';
  const amount = document.createElement('div');
  amount.className = 'expense-amount';
  amount.textContent = money(expense.amount, expense.currency || 'INR');
  const actions = document.createElement('div');
  actions.className = 'expense-actions';
  const copy = document.createElement('button');
  copy.className = 'expense-action';
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.setAttribute('aria-label', `Copy ${expense.title}`);
  copy.addEventListener('click', () => duplicateExpense(expense));
  const edit = document.createElement('button');
  edit.className = 'expense-action';
  edit.type = 'button';
  edit.textContent = 'Edit';
  edit.setAttribute('aria-label', `Edit ${expense.title}`);
  edit.addEventListener('click', () => editExpense(expense));
  const remove = document.createElement('button');
  remove.className = 'expense-action delete-button';
  remove.type = 'button';
  remove.textContent = 'Delete';
  remove.setAttribute('aria-label', `Delete ${expense.title}`);
  remove.addEventListener('click', async () => {
    if (!confirm(expense.recurringRule
      ? `Delete this "${expense.title}" entry? Future entries will still be added unless you pause its schedule.`
      : `Delete "${expense.title}"?`)) return;
    remove.disabled = true;
    try {
      await api(`/api/expenses/${expense._id}`, { method: 'DELETE' });
      if (editingId === expense._id) resetExpenseForm();
      await refresh();
    } catch (error) {
      showError('list-error', error.message);
      remove.disabled = false;
    }
  });
  actions.append(copy, edit, remove);
  side.append(amount, actions);
  row.append(main, side);
  return row;
}

async function loadExpenses(nextPage = 1) {
  const requestId = ++listRequestId;
  const params = new URLSearchParams({ page: nextPage, limit: 10 });
  if (filters.search) params.set('search', filters.search);
  if (filters.category) params.set('category', filters.category);
  if (filters.currency) params.set('currency', filters.currency);
  if (filters.startDate) params.set('startDate', `${filters.startDate}T00:00:00.000Z`);
  if (filters.endDate) params.set('endDate', `${filters.endDate}T23:59:59.999Z`);
  if (filters.sort && filters.sort !== 'date_desc') params.set('sort', filters.sort);
  const data = await api(`/api/expenses?${params}`);
  if (requestId !== listRequestId) return;
  page = nextPage;
  totalPages = data.totalPages;
  if (nextPage === 1) $('expense-list').replaceChildren();
  if (data.total === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = filters.search || filters.category || filters.currency || filters.startDate || filters.endDate
      ? 'No expenses match these filters.'
      : 'No expenses yet. Add your first one to get started.';
    $('expense-list').append(empty);
  } else {
    data.expenses.forEach(expense => $('expense-list').append(expenseRow(expense)));
  }
  $('expense-count').textContent = data.total.toLocaleString();
  $('expense-count-label').textContent = filters.search || filters.category || filters.currency || filters.startDate || filters.endDate
    ? 'Matching expenses' : 'Recorded expenses';
  const summaryEl = $('history-summary');
  if (data.total === 0) {
    summaryEl.textContent = '';
    summaryEl.hidden = true;
  } else {
    summaryEl.hidden = false;
    const totals = (data.totalsByCurrency || []).map(item => money(item.total, item._id));
    const totalText = totals.length ? ` · Total: ${totals.join(', ')}` : '';
    summaryEl.textContent = `${data.total.toLocaleString()} ${data.total === 1 ? 'expense' : 'expenses'}${totalText}`;
  }
  $('load-more').hidden = page >= totalPages;
}

async function refresh() {
  showError('list-error', '');
  try {
    await loadRecurring();
    await Promise.all([loadStats(), loadExpenses(), loadBudget()]);
  } catch (error) {
    showError('list-error', error.message);
  }
}

$('login-tab').addEventListener('click', () => setAuthMode('login'));
$('register-tab').addEventListener('click', () => setAuthMode('register'));
$('forgot-password').addEventListener('click', () => {
  $('forgot-email').value = $('email').value.trim();
  showRecovery('forgot');
});
$('back-to-login').addEventListener('click', () => {
  resetToken = null;
  setAuthMode('login');
});
$('forgot-form').addEventListener('submit', async event => {
  event.preventDefault();
  showError('forgot-error', '');
  showError('forgot-message', '');
  const submit = $('forgot-submit');
  submit.disabled = true;
  try {
    const result = await api('/api/auth/forgot-password', {
      method: 'POST', body: JSON.stringify({ email: $('forgot-email').value.trim() })
    });
    showError('forgot-message', result.message);
  } catch (error) {
    showError('forgot-error', error.message);
  } finally {
    submit.disabled = false;
  }
});
$('reset-form').addEventListener('submit', async event => {
  event.preventDefault();
  showError('reset-error', '');
  if ($('reset-password').value !== $('reset-confirm').value) {
    showError('reset-error', 'Passwords do not match.');
    return;
  }
  const submit = $('reset-submit');
  submit.disabled = true;
  try {
    await api('/api/auth/reset-password', {
      method: 'POST', body: JSON.stringify({ token: resetToken, password: $('reset-password').value })
    });
    resetToken = null;
    $('reset-form').reset();
    setAuthMode('login');
    showError('auth-message', 'Password updated. Log in with your new password.');
  } catch (error) {
    showError('reset-error', error.message);
  } finally {
    submit.disabled = false;
  }
});
$('change-password-form').addEventListener('submit', async event => {
  event.preventDefault();
  showError('account-error', '');
  showError('account-message', '');
  const submit = $('account-submit');
  submit.disabled = true;
  try {
    const result = await api('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: $('change-current-password').value,
        newPassword: $('change-new-password').value
      })
    });
    token = result.token;
    localStorage.setItem('expense-token', token);
    $('change-password-form').reset();
    showError('account-message', result.message);
  } catch (error) {
    showError('account-error', error.message);
  } finally {
    submit.disabled = false;
  }
});
$('currency-preference-form').addEventListener('submit', async event => {
  event.preventDefault();
  showError('currency-error', '');
  showError('currency-message', '');
  const submit = $('currency-submit');
  submit.disabled = true;
  try {
    const updated = await api('/api/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({ preferredCurrency: $('preferred-currency').value })
    });
    user.preferredCurrency = updated.preferredCurrency;
    applyCurrencyPreference(user.preferredCurrency);
    showError('currency-message', 'Default currency preference updated.');
    await loadBudget();
  } catch (error) {
    showError('currency-error', error.message);
  } finally {
    submit.disabled = false;
  }
});
$('delete-account-button').addEventListener('click', async () => {
  showError('delete-account-error', '');
  const confirmed = window.confirm('Are you sure you want to permanently delete your account and all associated data? This action cannot be undone.');
  if (!confirmed) return;
  const button = $('delete-account-button');
  button.disabled = true;
  try {
    await api('/api/auth/account', { method: 'DELETE' });
    signOut();
    showError('auth-message', 'Your account and data have been permanently deleted.');
  } catch (error) {
    showError('delete-account-error', error.message);
  } finally {
    button.disabled = false;
  }
});
$('logout').addEventListener('click', signOut);
$('cancel-edit').addEventListener('click', resetExpenseForm);
$('recurring-cancel').addEventListener('click', resetRecurringForm);
$('insights-period').addEventListener('change', async () => {
  try { await loadStats(); } catch (error) { showError('list-error', error.message); }
});
$('budget-month').addEventListener('change', async () => {
  showError('budget-error', '');
  showError('category-budget-error', '');
  try {
    await loadBudget();
  } catch (error) {
    showError('budget-error', error.message);
  }
});
$('budget-currency').addEventListener('change', async () => {
  showError('budget-error', '');
  showError('category-budget-error', '');
  try {
    await loadBudget();
  } catch (error) {
    showError('budget-error', error.message);
  }
});
$('category-budget-category').addEventListener('change', selectCategoryBudget);
$('category-budget-form').addEventListener('submit', async event => {
  event.preventDefault();
  showError('category-budget-error', '');
  const submit = $('category-budget-save');
  submit.disabled = true;
  try {
    const month = $('budget-month').value;
    const currency = $('budget-currency').value;
    const category = $('category-budget-category').value;
    await api(`/api/budgets/${month}/categories/${encodeURIComponent(category)}?currency=${currency}`, {
      method: 'PUT', body: JSON.stringify({ amount: Number($('category-budget-amount').value) })
    });
    await loadBudget();
  } catch (error) {
    showError('category-budget-error', error.message);
  } finally {
    submit.disabled = false;
  }
});
$('category-budget-clear').addEventListener('click', async () => {
  showError('category-budget-error', '');
  const button = $('category-budget-clear');
  button.disabled = true;
  try {
    const month = $('budget-month').value;
    const currency = $('budget-currency').value;
    const category = $('category-budget-category').value;
    await api(`/api/budgets/${month}/categories/${encodeURIComponent(category)}?currency=${currency}`, { method: 'DELETE' });
    await loadBudget();
  } catch (error) {
    showError('category-budget-error', error.message);
  } finally {
    button.disabled = false;
  }
});
$('budget-form').addEventListener('submit', async event => {
  event.preventDefault();
  showError('budget-error', '');
  const submit = $('budget-save');
  submit.disabled = true;
  try {
    await api(`/api/budgets/${$('budget-month').value}?currency=${$('budget-currency').value}`, {
      method: 'PUT', body: JSON.stringify({ amount: Number($('budget-amount').value) })
    });
    await loadBudget();
  } catch (error) {
    showError('budget-error', error.message);
  } finally {
    submit.disabled = false;
  }
});
$('budget-clear').addEventListener('click', async () => {
  showError('budget-error', '');
  $('budget-clear').disabled = true;
  try {
    await api(`/api/budgets/${$('budget-month').value}?currency=${$('budget-currency').value}`, { method: 'DELETE' });
    await loadBudget();
  } catch (error) {
    showError('budget-error', error.message);
  } finally {
    $('budget-clear').disabled = false;
  }
});
$('budget-copy').addEventListener('click', async () => {
  showError('budget-error', '');
  showError('category-budget-error', '');
  const button = $('budget-copy');
  button.disabled = true;
  try {
    await api(`/api/budgets/${$('budget-month').value}/copy-previous?currency=${$('budget-currency').value}`, { method: 'POST' });
    await loadBudget();
  } catch (error) {
    showError('budget-error', error.message);
  } finally {
    button.disabled = false;
  }
});
$('recurring-form').addEventListener('submit', async event => {
  event.preventDefault();
  showError('recurring-error', '');
  const submit = $('recurring-save');
  submit.disabled = true;
  try {
    const path = editingRecurringId ? `/api/recurring/${editingRecurringId}` : '/api/recurring';
    await api(path, { method: editingRecurringId ? 'PUT' : 'POST', body: JSON.stringify({
      title: $('recurring-title').value.trim(),
      amount: Number($('recurring-amount').value),
      currency: $('recurring-currency').value,
      category: $('recurring-category').value,
      frequency: $('recurring-frequency').value,
      startDate: $('recurring-start').value,
      description: $('recurring-description').value.trim()
    }) });
    resetRecurringForm();
    await refresh();
  } catch (error) {
    showError('recurring-error', error.message);
  } finally {
    submit.disabled = false;
  }
});
$('filter-form').addEventListener('submit', async event => {
  event.preventDefault();
  const startDate = $('filter-start').value;
  const endDate = $('filter-end').value;
  if (startDate && endDate && startDate > endDate) {
    showError('list-error', 'From date must be on or before To date.');
    return;
  }
  filters = { search: $('filter-search').value.trim(), category: $('filter-category').value,
    currency: $('filter-currency').value, startDate, endDate, sort: $('filter-sort').value };
  showError('list-error', '');
  try {
    await loadExpenses();
  } catch (error) {
    showError('list-error', error.message);
  }
});
$('clear-filters').addEventListener('click', async () => {
  $('filter-form').reset();
  filters = { search: '', category: '', currency: '', startDate: '', endDate: '', sort: 'date_desc' };
  showError('list-error', '');
  try {
    await loadExpenses();
  } catch (error) {
    showError('list-error', error.message);
  }
});

function applyDatePreset(preset) {
  const now = new Date();
  if (preset === 'today') {
    const today = localDate(now);
    $('filter-start').value = today;
    $('filter-end').value = today;
  } else if (preset === 'this_week') {
    const day = (now.getDay() + 6) % 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    $('filter-start').value = localDate(monday);
    $('filter-end').value = localDate(now);
  } else if (preset === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    $('filter-start').value = localDate(start);
    $('filter-end').value = localDate(now);
  } else if (preset === 'last_month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    $('filter-start').value = localDate(start);
    $('filter-end').value = localDate(end);
  } else if (preset === 'this_year') {
    const start = new Date(now.getFullYear(), 0, 1);
    $('filter-start').value = localDate(start);
    $('filter-end').value = localDate(now);
  }
}
$('filter-date-preset').addEventListener('change', () => {
  const preset = $('filter-date-preset').value;
  if (preset) {
    applyDatePreset(preset);
    $('filter-form').dispatchEvent(new Event('submit', { cancelable: true }));
  }
});
$('filter-start').addEventListener('input', () => { $('filter-date-preset').value = ''; });
$('filter-end').addEventListener('input', () => { $('filter-date-preset').value = ''; });

$('export-expenses').addEventListener('click', async () => {
  showError('list-error', '');
  const button = $('export-expenses');
  button.disabled = true;
  try {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.category) params.set('category', filters.category);
    if (filters.currency) params.set('currency', filters.currency);
    if (filters.startDate) params.set('startDate', `${filters.startDate}T00:00:00.000Z`);
    if (filters.endDate) params.set('endDate', `${filters.endDate}T23:59:59.999Z`);
    if (filters.sort && filters.sort !== 'date_desc') params.set('sort', filters.sort);
    const response = await fetch(`/api/expenses/export.csv?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) signOut();
      throw new Error(data.message || 'Could not export expenses');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = 'expenses.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    showError('list-error', error.message);
  } finally {
    button.disabled = false;
  }
});
$('load-more').addEventListener('click', async () => {
  $('load-more').disabled = true;
  try {
    await loadExpenses(page + 1);
  } catch (error) {
    showError('list-error', error.message);
  } finally {
    $('load-more').disabled = false;
  }
});

$('auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  showError('auth-error', '');
  const submit = $('auth-submit');
  submit.disabled = true;
  try {
    const body = { email: $('email').value.trim(), password: $('password').value };
    if (authMode === 'register') body.username = $('username').value.trim();
    const data = await api(`/api/auth/${authMode}`, { method: 'POST', body: JSON.stringify(body) });
    token = data.token;
    user = data.user;
    localStorage.setItem('expense-token', token);
    showView(true);
    await refresh();
  } catch (error) {
    showError('auth-error', error.message);
  } finally {
    submit.disabled = false;
  }
});

$('expense-form').addEventListener('submit', async event => {
  event.preventDefault();
  showError('expense-error', '');
  const submit = $('expense-submit');
  submit.disabled = true;
  try {
    const path = editingId ? `/api/expenses/${editingId}` : '/api/expenses';
    await api(path, { method: editingId ? 'PUT' : 'POST', body: JSON.stringify({
      title: $('expense-title').value.trim(),
      amount: Number($('expense-amount').value),
      currency: $('expense-currency').value,
      category: $('expense-category').value,
      date: `${$('expense-date').value}T12:00:00.000Z`,
      description: $('expense-description').value.trim()
    }) });
    resetExpenseForm();
    await refresh();
  } catch (error) {
    showError('expense-error', error.message);
  } finally {
    submit.disabled = false;
  }
});

function setToday() {
  const today = new Date();
  $('expense-date').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function setCurrentMonth() {
  const today = new Date();
  $('budget-month').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

function setRecurringToday() {
  $('recurring-start').value = localDate(new Date());
}

function fillCurrencyOptions() {
  for (const id of ['expense-currency', 'recurring-currency', 'budget-currency', 'filter-currency', 'preferred-currency']) {
    const select = $(id);
    if (id === 'filter-currency') select.add(new Option('All currencies', ''));
    for (const [code, name] of Object.entries(currencyNames)) {
      select.add(new Option(`${code} · ${name}`, code));
    }
  }
}

fillCurrencyOptions();
setToday();
setCurrentMonth();
setRecurringToday();
if (resetToken) {
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  signOut();
  showRecovery('reset');
} else if (token) {
  api('/api/auth/profile').then(profile => {
    user = profile;
    showView(true);
    refresh();
  }).catch(() => signOut());
}
