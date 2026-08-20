import * as authService from '../services/authService.js';
import { validateCredentials } from '../utils/validators.js';
import { config } from '../config/index.js';

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.env === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

export async function login(req, res, next) {
  try {
    const errors = validateCredentials(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors[0] });

    const user = await authService.authenticateUser(req.body.username, req.body.password);
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const token = authService.signToken(user);
    res.cookie('token', token, cookieOptions);
    return res.json({ user, token });
  } catch (error) {
    return next(error);
  }
}

export async function logout(req, res) {
  res.clearCookie('token');
  res.json({ ok: true });
}

export async function me(req, res, next) {
  try {
    const user = await authService.getUserById(req.user.id);
    if (!user) return res.status(401).json({ error: 'Session is no longer valid' });
    return res.json({ user });
  } catch (error) {
    return next(error);
  }
}

export async function updatePassword(req, res, next) {
  try {
    await authService.changePassword(req.user.id, req.body.currentPassword, req.body.newPassword);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}
