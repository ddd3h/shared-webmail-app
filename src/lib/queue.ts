// Minimal queue abstraction to decouple from actual implementation (e.g., BullMQ)

export type Job<T> = { name: string; data: T };

export interface Queue<T> {
  add: (job: Job<T>) => Promise<void>;
  process?: (handler: (job: Job<T>) => Promise<void>) => void;
}

export function createInMemoryQueue<T>(): Queue<T> {
  const listeners: Array<(job: Job<T>) => Promise<void>> = [];
  return {
    async add(job) {
      // fire-and-forget in-memory for MVP stub
      await Promise.all(listeners.map((fn) => fn(job)));
    },
    process(handler) {
      if (handler) listeners.push(handler);
    }
  };
}

// Queues used across the system
export type SendMailPayload = { messageId: string };
export type SyncMailboxPayload = { mailboxId: string };
export type MattermostNotifyPayload = { userId: string; threadId?: string; type: string };
export type PushNotifyPayload = { userId: string; title: string; body: string; url: string; priority: 'high' | 'normal' | 'low' };

export const queues = {
  sendMail: createInMemoryQueue<SendMailPayload>(),
  syncMailbox: createInMemoryQueue<SyncMailboxPayload>(),
  mattermost: createInMemoryQueue<MattermostNotifyPayload>(),
  push: createInMemoryQueue<PushNotifyPayload>()
};

