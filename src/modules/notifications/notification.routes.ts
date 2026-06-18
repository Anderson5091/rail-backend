import { z } from "zod";
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../../middleware/auth";
import { notificationService } from "./notification.service";

const router = Router();

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  const notifications = await notificationService.getUserNotifications(req.userId!);
  res.json(notifications);
});

router.get("/unread", authenticate, async (req: AuthRequest, res: Response) => {
  const notifications = await notificationService.getUnreadNotifications(req.userId!);
  res.json(notifications);
});

router.get("/unread-count", authenticate, async (req: AuthRequest, res: Response) => {
  const count = await notificationService.getUnreadCount(req.userId!);
  res.json({ count });
});

const markReadSchema = z.object({
  notificationId: z.string(),
});

router.post("/mark-read", authenticate, async (req: AuthRequest, res: Response) => {
  const { notificationId } = markReadSchema.parse(req.body);
  await notificationService.markAsRead(notificationId);
  res.json({ success: true });
});

router.post("/mark-all-read", authenticate, async (req: AuthRequest, res: Response) => {
  await notificationService.markAllAsRead(req.userId!);
  res.json({ success: true });
});

export { router as notificationRoutes };
