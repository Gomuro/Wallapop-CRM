-- Pin each account to the Chrome place it already has.
-- A later delete must not move the survivors onto another profile.

ALTER TABLE "accounts" ADD COLUMN "chrome_slot" INTEGER;

UPDATE "accounts" AS a
SET "chrome_slot" = 0
WHERE a."is_default" = true;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS n
  FROM "accounts"
  WHERE "is_default" = false
)
UPDATE "accounts" AS a
SET "chrome_slot" = ranked.n
FROM ranked
WHERE a.id = ranked.id;

ALTER TABLE "accounts" ALTER COLUMN "chrome_slot" SET NOT NULL;

CREATE UNIQUE INDEX "accounts_chrome_slot_key" ON "accounts"("chrome_slot");
