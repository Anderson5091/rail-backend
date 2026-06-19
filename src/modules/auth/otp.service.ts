import crypto from "crypto";
import { prisma } from "../../config/database";
import { ENV } from "../../config/env";
import { logger } from "../../utils/logger";
import { Resend } from "resend";

function generateOtpCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken(): string {
  return crypto.randomUUID();
}

const resendClient = ENV.RESEND_API_KEY ? new Resend(ENV.RESEND_API_KEY) : null;

async function sendEmail(email: string, code: string): Promise<boolean> {
  if (!resendClient) {
    logger.info(`[OTP] Resend not configured - code for ${email}: ${code}`);
    return false;
  }

  try {
    await resendClient.emails.send({
      from: ENV.RESEND_FROM || "Quick Send <noreply@quicksend.com.mx>",
      to: email,
      subject: "Your Quick Send verification code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1a73e8;">Quick Send Verification</h2>
          <p>Your verification code is:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 16px; background: #f5f5f5; border-radius: 8px; margin: 16px 0;">
            ${code}
          </div>
          <p style="color: #666;">This code expires in 5 minutes.</p>
        </div>
      `,
    });

    logger.info(`[OTP] Email sent to ${email}`);
    return true;
  } catch (error: any) {
    logger.error(`[OTP] Email failed for ${email}: ${error.message}`);
    return false;
  }
}

export const otpService = {
  generateToken,

  async sendOtp(phone: string, email: string): Promise<string> {
    const code = generateOtpCode();
    const emailSent = await sendEmail(email, code);

    if (!emailSent) {
      logger.info(`[OTP] Email failed, code for ${email}: ${code}`);
    }

    return code;
  },

  async sendOtpEmailOnly(email: string): Promise<string> {
    const code = generateOtpCode();
    await sendEmail(email, code);
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
