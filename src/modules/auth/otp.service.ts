import crypto from "crypto";
import { prisma } from "../../config/database";
import { ENV } from "../../config/env";
import { logger } from "../../utils/logger";
import { BrevoClient } from "@getbrevo/brevo";

function generateOtpCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken(): string {
  return crypto.randomUUID();
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

async function sendEmailNative(email: string, code: string): Promise<void> {
  logger.info(`[OTP] Email verification code for ${email}: ${code}`);
}

export const otpService = {
  generateToken,

  async sendOtp(phone: string, email: string): Promise<string> {
    const code = generateOtpCode();
    const smsSent = await sendSms(phone, code);

    if (!smsSent) {
      logger.info(`[OTP] SMS failed, sending code via email to ${email}`);
      await sendEmailNative(email, code);
    }

    if (!smsSent) {
      logger.info(`[OTP] No delivery channel available - code for ${email}: ${code}`);
    }

    return code;
  },

  async sendOtpEmailOnly(email: string): Promise<string> {
    const code = generateOtpCode();
    await sendEmailNative(email, code);
    return code;
  },

  async storeRegistration(data: {
    email: string;
    phone: string;
    fullName: string;
    password: string;
  }): Promise<{ token: string; code: string }> {
    const token = generateToken();
    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.otpCode.create({
      data: { token, code, type: "PHONE_VERIFICATION", expiresAt, data },
    });

    return { token, code };
  },

  async storeOtpCode(token: string, code: string): Promise<void> {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.otpCode.create({
      data: { token, code, type: "PHONE_VERIFICATION", expiresAt },
    });
  },

  async verifyOtp(token: string, code: string): Promise<any | null> {
    const otp = await prisma.otpCode.findFirst({
      where: {
        token,
        code,
        type: "PHONE_VERIFICATION",
        verified: false,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otp) return null;

    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { verified: true },
    });

    return otp.data;
  },
};
