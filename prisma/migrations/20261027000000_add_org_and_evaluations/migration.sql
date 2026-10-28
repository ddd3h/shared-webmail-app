-- AlterTable
ALTER TABLE "users" ADD COLUMN     "org_unit_id" TEXT,
ADD COLUMN     "position_id" TEXT;

-- CreateTable
CREATE TABLE "org_units" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "head_user_id" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_positions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "permissions" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_cycles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_by_id" TEXT,
    "opened_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_criteria" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "eval_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "evaluator_id" TEXT,
    "self_comment" TEXT,
    "self_submitted_at" TIMESTAMP(3),
    "manager_comment" TEXT,
    "manager_submitted_at" TIMESTAMP(3),
    "score" DOUBLE PRECISION,
    "grade" TEXT,
    "final_comment" TEXT,
    "finalized_at" TIMESTAMP(3),
    "finalized_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_scores" (
    "id" TEXT NOT NULL,
    "evaluation_id" TEXT NOT NULL,
    "criterion_id" TEXT NOT NULL,
    "self_score" INTEGER,
    "self_comment" TEXT,
    "manager_score" INTEGER,
    "manager_comment" TEXT,

    CONSTRAINT "eval_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_units_parent_id_idx" ON "org_units"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_positions_name_key" ON "org_positions"("name");

-- CreateIndex
CREATE INDEX "eval_criteria_cycle_id_idx" ON "eval_criteria"("cycle_id");

-- CreateIndex
CREATE INDEX "evaluations_evaluator_id_idx" ON "evaluations"("evaluator_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluations_cycle_id_user_id_key" ON "evaluations"("cycle_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "eval_scores_evaluation_id_criterion_id_key" ON "eval_scores"("evaluation_id", "criterion_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "org_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_head_user_id_fkey" FOREIGN KEY ("head_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_criteria" ADD CONSTRAINT "eval_criteria_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "eval_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "eval_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_evaluator_id_fkey" FOREIGN KEY ("evaluator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_scores" ADD CONSTRAINT "eval_scores_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_scores" ADD CONSTRAINT "eval_scores_criterion_id_fkey" FOREIGN KEY ("criterion_id") REFERENCES "eval_criteria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

