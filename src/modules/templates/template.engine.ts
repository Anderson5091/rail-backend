import { logger } from "../../utils/logger";

const templates: Record<string, Record<string, string>> = {
  email: {
    TRANSFER_COMPLETED: "<h1>Transfer Completed</h1><p>{{message}}</p>",
    TRANSFER_FAILED: "<h1>Transfer Failed</h1><p>{{message}}</p>",
    KYC_APPROVED: "<h1>KYC Approved</h1><p>{{message}}</p>",
    KYC_REJECTED: "<h1>KYC Rejected</h1><p>{{message}}</p>",
    PAYOUT_SENT: "<h1>Payout Sent</h1><p>{{message}}</p>",
    default: "<h1>{{title}}</h1><p>{{message}}</p>",
  },
};

class TemplateEngine {
  render(channel: string, type: string, data: Record<string, unknown>): string {
    const channelTemplates = templates[channel];
    if (!channelTemplates) {
      logger.warn(`No templates found for channel: ${channel}`);
      return String(data.message || "");
    }

    const template = channelTemplates[type] || channelTemplates.default || "";
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key] ?? ""));
  }
}

export const templateEngine = new TemplateEngine();
