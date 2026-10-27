-- 源泉徴収（所得税）の税額表の欄: 'ko' = 甲欄 (default), 'otsu' = 乙欄, chosen per person
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "withholding_class" TEXT NOT NULL DEFAULT 'ko';
