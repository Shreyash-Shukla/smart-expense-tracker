const $ = id => document.getElementById(id);
const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
let token = localStorage.getItem('expense-token');
let user = null;
let page = 1;
let totalPages = 1;
let authMode = 'login';

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
  token = null;
  user = null;
  localStorage.removeItem('expense-token');
  showView(false);
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
  const remove = document.createElement('button');
  remove.className = 'delete-button';
  remove.type = 'button';
  remove.textContent = 'Delete';
  remove.setAttribute('aria-label', `Delete ${expense.title}`);
  remove.addEventListener('click', async () => {
    if (!confirm(`Delete "${expense.title}"?`)) return;
    remove.disabled = true;
    try {
      await api(`/api/expenses/${expense._id}`, { method: 'DELETE' });
      await refresh();
    } catch (error) {
      showError('list-error', error.message);
      remove.disabled = false;
    }
  });
  side.append(amount, remove);
  row.append(main, side);
  return row;
}

async function loadExpenses(nextPage = 1) {
  const data = await api(`/api/expenses?page=${nextPage}&limit=10`);
  page = nextPage;
  totalPages = data.totalPages;
  if (nextPage === 1) $('expense-list').replaceChildren();
  if (data.total === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No expenses yet. Add your first one to get started.';
    $('expense-list').append(empty);
  } else {
    data.expenses.forEach(expense => $('expense-list').append(expenseRow(expense)));
  }
  $('expense-count').textContent = data.total.toLocaleString();
  $('load-more').hidden = page >= totalPages;
}

async function refresh() {
  showError('list-error', '');
  try {
    await Promise.all([loadStats(), loadExpenses()]);
  } catch (error) {
    showError('list-error', error.message);
  }
}

$('login-tab').addEventListener('click', () => setAuthMode('login'));
$('register-tab').addEventListener('click', () => setAuthMode('register'));
$('logout').addEventListener('click', signOut);
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
    await api('/api/expenses', { method: 'POST', body: JSON.stringify({
      title: $('expense-title').value.trim(),
      amount: Number($('expense-amount').value),
      category: $('expense-category').value,
      date: `${$('expense-date').value}T12:00:00`,
      description: $('expense-description').value.trim()
    }) });
    $('expense-form').reset();
    setToday();
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

setToday();
if (token) {
  api('/api/auth/profile').then(profile => {
    user = profile;
    showView(true);
    refresh();
  }).catch(() => signOut());
}
