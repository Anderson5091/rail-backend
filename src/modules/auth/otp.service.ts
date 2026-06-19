import crypto from "crypto";
import "dotenv/config";
import { prisma } from "../../config/database";
import { logger } from "../../utils/logger";
import { Resend } from "resend";

function generateOtpCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken(): string {
  return crypto.randomUUID();
}

const resend = new Resend(process.env.RESEND_API_KEY);
const from = process.env.EMAIL_FROM || "Quick Send <noreply@quicksend.com.mx>";

export const otpService = {
  generateToken,

  async sendOtp(phone: string, email: string): Promise<string> {
    const code = generateOtpCode();

    const { error } = await resend.emails.send({
      from,
      to: email,
      subject: "Your Quick Send verification code",
      html: `<h2>Quick Send Verification</h2><p>Your verification code is: <strong>${code}</strong></p><p>This code expires in 5 minutes.</p>`,
    });

    if (error) {
      logger.error(`[OTP] Email failed for ${email}: ${error.message}`);
    } else {
      logger.info(`[OTP] Email sent to ${email}`);
    }

    return code;
  },

  async sendOtpEmailOnly(email: string): Promise<string> {
    const code = generateOtpCode();

    const { error } = await resend.emails.send({
      from,
      to: email,
      subject: "Your Quick Send verification code",
      html: `<h2>Quick Send Verification</h2><p>Your verification code is: <strong>${code}</strong></p><p>This code expires in 5 minutes.</p>`,
    });

    if (error) {
      logger.error(`[OTP] Email failed for ${email}: ${error.message}`);
    }

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
