import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import jwt from "jsonwebtoken";
import { ENV } from "../config/env";
import { logger } from "../utils/logger";

interface AuthenticatedSocket extends WebSocket {
  userId?: string;
  role?: string;
  isAlive?: boolean;
}

const userSockets: Map<string, Set<AuthenticatedSocket>> = new Map();
const adminSockets: Set<AuthenticatedSocket> = new Set();
let wss: WebSocketServer | null = null;

const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "COMPLIANCE", "OPS", "TREASURY"];

export function setupWebSocket(server: import("http").Server) {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: AuthenticatedSocket, req: IncomingMessage) => {
    ws.isAlive = true;

    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const token = url.searchParams.get("token");

    if (!token) {
      ws.close(4001, "Authentication required");
      return;
    }

    try {
      const decoded = jwt.verify(token, ENV.JWT_SECRET) as { userId: string; role?: string };
      ws.userId = decoded.userId;
      ws.role = decoded.role || "USER";

      const sockets = userSockets.get(decoded.userId) || new Set();
      sockets.add(ws);
      userSockets.set(decoded.userId, sockets);

      if (ADMIN_ROLES.includes(ws.role)) {
        adminSockets.add(ws);
        logger.info(`[WS] Admin ${decoded.userId} (${ws.role}) connected`);
      }

      logger.info(`[WS] User ${decoded.userId} connected`);

      ws.on("pong", () => {
        ws.isAlive = true;
      });

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === "PING") {
            ws.send(JSON.stringify({ type: "PONG" }));
          } else if (message.type === "SUBSCRIBE" && message.channel) {
            ws.send(JSON.stringify({ type: "SUBSCRIBED", channel: message.channel }));
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.on("close", () => {
        const sockets = userSockets.get(decoded.userId!);
        if (sockets) {
          sockets.delete(ws);
          if (sockets.size === 0) {
            userSockets.delete(decoded.userId!);
          }
        }
        adminSockets.delete(ws);
        logger.info(`[WS] ${ADMIN_ROLES.includes(ws.role!) ? "Admin" : "User"} ${decoded.userId} disconnected`);
      });

      ws.send(JSON.stringify({ type: "CONNECTED", userId: decoded.userId }));
    } catch {
      ws.close(4001, "Invalid token");
    }
  });

  const heartbeat = setInterval(() => {
    wss?.clients.forEach((ws) => {
      const sock = ws as AuthenticatedSocket;
      if (sock.isAlive === false) {
        return sock.terminate();
      }
      sock.isAlive = false;
      sock.ping();
    });
  }, 30000);

  wss.on("close", () => {
    clearInterval(heartbeat);
  });

  logger.info("[WS] WebSocket server initialized with admin channels");
}

export function broadcastToUser(userId: string, data: unknown) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;

  const message = JSON.stringify(data);
  sockets.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
}

export function broadcastToAll(data: unknown) {
  if (!wss) return;
  const message = JSON.stringify(data);
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
}

export function broadcastToAdmins(data: unknown) {
  const message = JSON.stringify(data);
  adminSockets.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
}

export function getAdminCount(): number {
  return adminSockets.size;
}

export function getConnectedUserCount(): number {
  return userSockets.size;
}
