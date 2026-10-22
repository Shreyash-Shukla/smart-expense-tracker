const express = require('express');
const jwt = require('jsonwebtoken');
const { randomBytes, createHash } = require('node:crypto');
const validator = require('validator');
const { rateLimit } = require('express-rate-limit');
const User = require('../models/User');
const PasswordResetToken = require('../models/PasswordResetToken');
const auth = require('../middleware/auth');
const { recoveryConfigured, sendPasswordReset } = require('../services/mail');

const router = express.Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again later.' }
});
router.use(['/register', '/login'], authLimiter);
const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again later.' }
});
router.use(['/forgot-password', '/reset-password'], recoveryLimiter);

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 30 ||
        !validator.isEmail(email) || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ message: 'Enter a username (3–30 characters), valid email and password (at least 8 characters)' });
    }

    // Check if user exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create new user
    const user = new User({ username: username.trim(), email, password });
    await user.save();

    // Generate token
    const token = jwt.sign({ userId: user._id, sessionVersion: user.sessionVersion }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: 'User already exists' });
    console.error(error);
    res.status(500).json({ message: 'Could not register user' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const { password } = req.body || {};
    if (!validator.isEmail(email) || typeof password !== 'string') {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Generate token
    const token = jwt.sign({ userId: user._id, sessionVersion: user.sessionVersion ?? 0 }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not log in' });
  }
});

router.post('/forgot-password', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!validator.isEmail(email)) return res.status(400).json({ message: 'Enter a valid email address' });
  if (!recoveryConfigured()) return res.status(503).json({ message: 'Password recovery is not configured' });

  const response = { message: 'If this email is registered, you will receive a reset link.' };
  try {
    const user = await User.findOne({ email });
    if (user) {
      const token = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await PasswordResetToken.findOneAndUpdate(
        { user: user._id },
        { $set: { tokenHash, expiresAt: new Date(Date.now() + 30 * 60 * 1000) } },
        { upsert: true, runValidators: true }
      );
      try {
        await sendPasswordReset(user.email, token);
      } catch (error) {
        await PasswordResetToken.deleteOne({ user: user._id, tokenHash });
        console.error('Could not send password reset email:', error);
      }
    }
    res.json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not request password reset' });
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) ||
      typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ message: 'Enter a valid reset link and a password of 8–128 characters' });
  }
  try {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const reset = await PasswordResetToken.findOneAndDelete({ tokenHash, expiresAt: { $gt: new Date() } });
    if (!reset) return res.status(400).json({ message: 'Reset link is invalid or expired' });
    const user = await User.findById(reset.user);
    if (!user) return res.status(400).json({ message: 'Reset link is invalid or expired' });
    user.password = password;
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    await user.save();
    res.json({ message: 'Password updated. Please log in.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not reset password' });
  }
});

// Get user profile
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password -sessionVersion');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Could not load profile' });
  }
});

module.exports = router;
