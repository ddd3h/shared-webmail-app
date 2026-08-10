-- CreateTable
CREATE TABLE "draft_attachments" (
    "id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "draft_attachments_draft_id_idx" ON "draft_attachments"("draft_id");

-- AddForeignKey
ALTER TABLE "draft_attachments" ADD CONSTRAINT "draft_attachments_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
