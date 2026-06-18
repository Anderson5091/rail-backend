import { Router, Response } from "express";
import { prisma } from "../../config/database";
import { authenticate, AuthRequest } from "../../middleware/auth";

const router = Router();

router.put("/profile", authenticate, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.update({
    where: { id: req.userId },
    data: req.body,
    select: { id: true, email: true, fullName: true, phone: true },
  });
  res.json(user);
});

export { router as userRoutes };
