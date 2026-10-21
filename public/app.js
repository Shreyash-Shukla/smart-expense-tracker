const $ = id => document.getElementById(id);
const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
let token = localStorage.getItem('expense-token');
let user = null;
let page = 1;
let totalPages = 1;
let authMode = 'login';
let editingId = null;
let filters = { category: '', startDate: '', endDate: '' };
let listRequestId = 0;
let budgetRequestId = 0;

function showError(id, message) {
  $(id).textContent = message || '';
  $(id).hidden = !message;
}

function showView(signedIn) {
  $('auth-view').hidden = signedIn;
  $('dashboard-view').hidden = !signedIn;
  $('logout').hidden = !signedIn;
  if (signedIn) $('greeting').textContent = `Hi, ${user.username}`;
}

function signOut() {
  resetExpenseForm();
  $('filter-form').reset();
  filters = { category: '', startDate: '', endDate: '' };
  budgetRequestId++;
  $('budget-form').reset();
  setCurrentMonth();
  $('budget-status').textContent = '';
  $('budget-progress').hidden = true;
  token = null;
  user = null;
  localStorage.removeItem('expense-token');
  showView(false);
}

function localDate(date) {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function resetExpenseForm() {
  editingId = null;
  $('expense-form').reset();
  setToday();
  $('add-heading').textContent = 'Add an expense';
  $('expense-submit').textContent = 'Save expense';
  $('cancel-edit').hidden = true;
  showError('expense-error', '');
}

function editExpense(expense) {
  editingId = expense._id;
  $('expense-title').value = expense.title;
  $('expense-amount').value = expense.amount;
  $('expense-date').value = localDate(expense.date);
  $('expense-category').value = expense.category;
  $('expense-description').value = expense.description || '';
  $('add-heading').textContent = 'Edit expense';
  $('expense-submit').textContent = 'Update expense';
  $('cancel-edit').hidden = false;
  showError('expense-error', '');
  $('expense-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('expense-title').focus({ preventScroll: true });
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
}

async function loadStats() {
  const stats = await api('/api/dashboard/stats?period=month');
  $('month-total').textContent = money(stats.totalExpenses);
}

function renderBudget(data) {
  $('budget-amount').value = data.budget ?? '';
  $('budget-clear').hidden = data.budget === null;
  const progress = $('budget-progress');
  progress.hidden = data.budget === null;
  if (data.budget === null) {
    $('budget-status').textContent = `${money(data.spent)} spent in the selected month. Set a budget to track what remains.`;
    return;
  }
  const percent = Math.round(data.spent / data.budget * 100);
  progress.setAttribute('aria-valuenow', String(Math.min(percent, 100)));
  progress.setAttribute('aria-valuetext', `${percent}% of budget used`);
  progress.classList.toggle('over', data.remaining < 0);
  $('budget-progress-fill').style.width = `${Math.min(percent, 100)}%`;
  $('budget-status').textContent = data.remaining >= 0
    ? `${money(data.spent)} spent of ${money(data.budget)} · ${money(data.remaining)} left`
    : `${money(data.spent)} spent of ${money(data.budget)} · ${money(-data.remaining)} over budget`;
}

async function loadBudget() {
  const month = $('budget-month').value;
  const requestId = ++budgetRequestId;
  const data = await api(`/api/budgets/${month}`);
  if (requestId === budgetRequestId && month === $('budget-month').value) renderBudget(data);
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
  meta.textContent = `${expense.category} · ${new Date(expense.date).toLocaleDateString()}`;
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
  amount.textContent = money(expense.amount);
  const actions = document.createElement('div');
  actions.className = 'expense-actions';
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
    if (!confirm(`Delete "${expense.title}"?`)) return;
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
  actions.append(edit, remove);
  side.append(amount, actions);
  row.append(main, side);
  return row;
}

async function loadExpenses(nextPage = 1) {
  const requestId = ++listRequestId;
  const params = new URLSearchParams({ page: nextPage, limit: 10 });
  if (filters.category) params.set('category', filters.category);
  if (filters.startDate) params.set('startDate', new Date(`${filters.startDate}T00:00:00`).toISOString());
  if (filters.endDate) params.set('endDate', new Date(`${filters.endDate}T23:59:59.999`).toISOString());
  const data = await api(`/api/expenses?${params}`);
  if (requestId !== listRequestId) return;
  page = nextPage;
  totalPages = data.totalPages;
  if (nextPage === 1) $('expense-list').replaceChildren();
  if (data.total === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = filters.category || filters.startDate || filters.endDate
      ? 'No expenses match these filters.'
      : 'No expenses yet. Add your first one to get started.';
    $('expense-list').append(empty);
  } else {
    data.expenses.forEach(expense => $('expense-list').append(expenseRow(expense)));
  }
  $('expense-count').textContent = data.total.toLocaleString();
  $('expense-count-label').textContent = filters.category || filters.startDate || filters.endDate
    ? 'Matching expenses' : 'Recorded expenses';
  $('load-more').hidden = page >= totalPages;
}

async function refresh() {
  showError('list-error', '');
  try {
    await Promise.all([loadStats(), loadExpenses(), loadBudget()]);
  } catch (error) {
    showError('list-error', error.message);
  }
}

$('login-tab').addEventListener('click', () => setAuthMode('login'));
$('register-tab').addEventListener('click', () => setAuthMode('register'));
$('logout').addEventListener('click', signOut);
$('cancel-edit').addEventListener('click', resetExpenseForm);
$('budget-month').addEventListener('change', async () => {
  showError('budget-error', '');
  try {
    await loadBudget();
  } catch (error) {
    showError('budget-error', error.message);
  }
});
$('budget-form').addEventListener('submit', async event => {
  event.preventDefault();
  showError('budget-error', '');
  const submit = $('budget-save');
  submit.disabled = true;
  try {
    await api(`/api/budgets/${$('budget-month').value}`, {
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
    await api(`/api/budgets/${$('budget-month').value}`, { method: 'DELETE' });
    await loadBudget();
  } catch (error) {
    showError('budget-error', error.message);
  } finally {
    $('budget-clear').disabled = false;
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
  filters = { category: $('filter-category').value, startDate, endDate };
  showError('list-error', '');
  try {
    await loadExpenses();
  } catch (error) {
    showError('list-error', error.message);
  }
});
$('clear-filters').addEventListener('click', async () => {
  $('filter-form').reset();
  filters = { category: '', startDate: '', endDate: '' };
  showError('list-error', '');
  try {
    await loadExpenses();
  } catch (error) {
    showError('list-error', error.message);
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
      category: $('expense-category').value,
      date: `${$('expense-date').value}T12:00:00`,
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

setToday();
setCurrentMonth();
if (token) {
  api('/api/auth/profile').then(profile => {
    user = profile;
    showView(true);
    refresh();
  }).catch(() => signOut());
}
