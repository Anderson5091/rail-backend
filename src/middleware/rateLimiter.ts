import rateLimit from "express-rate-limit";

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many auth attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: "Too many admin requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const payoutLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: { error: "Too many payout requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  message: { error: "Too many webhook requests" },
  standardHeaders: true,
  legacyHeaders: false,
});
