import { prisma } from "../../config/database";
import { ENV } from "../../config/env";
import { logger } from "../../utils/logger";
import { BrevoClient } from "@getbrevo/brevo";

function generateOtpCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendSms(phone: string, code: string): Promise<boolean> {
  if (!ENV.BREVO_API_KEY) {
    logger.warn("[OTP] Brevo API key not configured, skipping SMS");
    return false;
  }

  try {
    const apiInstance = new BrevoClient({ apiKey: ENV.BREVO_API_KEY });

    await apiInstance.transactionalSms.sendTransacSms({
      sender: ENV.BREVO_SMS_SENDER,
      recipient: phone,
      content: `Your Quick Send verification code is ${code}. It expires in 5 minutes.`,
      type: "transactional",
    });

    logger.info(`[OTP] SMS sent to ${phone}`);
    return true;
  } catch (error: any) {
    logger.error(`[OTP] SMS failed for ${phone}: ${error.message}`);
    return false;
  }
}

async function sendEmail(email: string, code: string): Promise<void> {
  const emailKey = ENV.BREVO_EMAIL_API_KEY || ENV.BREVO_API_KEY;
  if (!emailKey) {
    logger.info(`[OTP] Email fallback to ${email}: code ${code}`);
    return;
  }

  try {
    const apiInstance = new BrevoClient({ apiKey: emailKey });

    await apiInstance.transactionalEmails.sendTransacEmail({
      subject: "Your Quick Send Verification Code",
      sender: { email: ENV.BREVO_EMAIL_FROM, name: ENV.BREVO_EMAIL_NAME },
      to: [{ email }],
      htmlContent: `<h2>Phone Verification</h2><p>Your verification code is: <strong>${code}</strong></p><p>This code expires in 5 minutes.</p>`,
    });

    logger.info(`[OTP] Email sent to ${email}`);
  } catch (error: any) {
    logger.error(`[OTP] Email failed for ${email}: ${error.message}`);
    logger.info(`[OTP] Fallback - code for ${email}: ${code}`);
  }
}

export const otpService = {
  async sendOtp(userId: string, phone: string, email?: string): Promise<string> {
    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.otpCode.create({
      data: { userId, code, type: "PHONE_VERIFICATION", expiresAt },
    });

    const smsSent = await sendSms(phone, code);

    if (!smsSent && email) {
      logger.info(`[OTP] SMS failed, sending code via email to ${email}`);
      await sendEmail(email, code);
    }

    if (!smsSent && !email) {
      logger.info(`[OTP] No delivery channel available - code for ${phone} (user ${userId}): ${code}`);
    }

    return code;
  },

  async sendOtpEmailOnly(userId: string, email: string): Promise<string> {
    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.otpCode.create({
      data: { userId, code, type: "PHONE_VERIFICATION", expiresAt },
    });

    await sendEmail(email, code);

    return code;
  },

  async verifyOtp(userId: string, code: string): Promise<boolean> {
    const otp = await prisma.otpCode.findFirst({
      where: {
        userId,
        code,
        type: "PHONE_VERIFICATION",
        verified: false,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otp) return false;

    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { verified: true },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { phoneVerified: true },
    });

    return true;
  },
};
