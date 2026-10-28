-- CreateTable
CREATE TABLE "thread_embeddings" (
    "thread_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dims" INTEGER NOT NULL,
    "vector" BYTEA NOT NULL,
    "embedded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_embeddings_pkey" PRIMARY KEY ("thread_id")
);

-- AddForeignKey
ALTER TABLE "thread_embeddings" ADD CONSTRAINT "thread_embeddings_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
