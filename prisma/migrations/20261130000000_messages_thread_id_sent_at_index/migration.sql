-- A thread's mails in order: the first sender of every thread in a list, and the messages of a thread.
-- Without it each of those lookups read the whole messages table (prod, 2026-11: 0.8 ms each, 3,000 of them per list).
CREATE INDEX "messages_thread_id_sent_at_idx" ON "messages"("thread_id", "sent_at");
