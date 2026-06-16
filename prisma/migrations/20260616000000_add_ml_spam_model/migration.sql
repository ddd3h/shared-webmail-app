-- CreateTable
CREATE TABLE "ml_spam_model" (
    "id" TEXT NOT NULL,
    "model_data" TEXT NOT NULL,
    "trained_at" TIMESTAMP(3) NOT NULL,
    "spam_count" INTEGER NOT NULL,
    "ham_count" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ml_spam_model_pkey" PRIMARY KEY ("id")
);
