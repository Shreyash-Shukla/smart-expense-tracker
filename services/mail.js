const nodemailer = require('nodemailer');

function recoveryConfigured() {
  try {
    const base = new URL(process.env.APP_BASE_URL);
    const port = Number(process.env.SMTP_PORT);
    const localHttp = base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname);
    const authComplete = Boolean(process.env.SMTP_USER) === Boolean(process.env.SMTP_PASS);
    return Boolean((base.protocol === 'https:' || localHttp) && process.env.SMTP_HOST &&
      Number.isInteger(port) && port > 0 && port <= 65535 && process.env.SMTP_FROM && authComplete);
  } catch (error) {
    return false;
  }
}

async function sendPasswordReset(email, token) {
  const url = new URL('/', process.env.APP_BASE_URL);
  url.hash = new URLSearchParams({ reset: token }).toString();
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    ...(process.env.SMTP_USER && process.env.SMTP_PASS
      ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
      : {})
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: 'Reset your Smart Expense Tracker password',
    text: `Use this link to reset your password within 30 minutes:\n\n${url}\n\nIf you did not request this, you can ignore this email.`
  });
}

module.exports = { recoveryConfigured, sendPasswordReset };
