-- where each 部署 sits on the org diagram (NULL = placed automatically)
ALTER TABLE "org_units" ADD COLUMN IF NOT EXISTS "pos_x" DOUBLE PRECISION;
ALTER TABLE "org_units" ADD COLUMN IF NOT EXISTS "pos_y" DOUBLE PRECISION;
