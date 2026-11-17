-- 0004 — consolidate duplicate active list rows (ADR-0007)
-- Invariant going forward: at most one ACTIVE row per (store_id, item_id).
-- This migration folds history created before the rule:
--   * survivor = the group's first row by (sort_order, created_at, id)
--   * when every row in the group shares one unit (NULL included), the
--     survivor's qty becomes the sum of the group (SUM ignores NULLs; an
--     all-NULL group stays NULL)
--   * mixed-unit groups keep the survivor's own qty/unit (their adds are
--     historically distinct lines; the per-add events remain in change_log)
--   * bought/cleared rows are untouched (they never merge — §4.6 lifecycle)
-- Data-only: no DDL, so the schema hash is unchanged.

-- 1) Fold same-unit group sums into the survivor.
UPDATE list_items
SET qty_value = (
      SELECT SUM(li.qty_value)
      FROM list_items li
      WHERE li.store_id = list_items.store_id
        AND li.item_id = list_items.item_id
        AND li.status = 'active'
    ),
    updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE status = 'active'
  AND id = (
    SELECT li2.id
    FROM list_items li2
    WHERE li2.store_id = list_items.store_id
      AND li2.item_id = list_items.item_id
      AND li2.status = 'active'
    ORDER BY li2.sort_order, li2.created_at, li2.id
    LIMIT 1
  )
  AND (
    SELECT COUNT(*)
    FROM list_items li4
    WHERE li4.store_id = list_items.store_id
      AND li4.item_id = list_items.item_id
      AND li4.status = 'active'
  ) > 1
  AND (
    SELECT COUNT(DISTINCT IFNULL(li3.unit_code, '~null~'))
    FROM list_items li3
    WHERE li3.store_id = list_items.store_id
      AND li3.item_id = list_items.item_id
      AND li3.status = 'active'
  ) <= 1;

-- 2) Remove the folded duplicates (and mixed-unit group members that are
--    not the survivor — the survivor's own quantities stand).
DELETE FROM list_items
WHERE status = 'active'
  AND id NOT IN (
    SELECT id
    FROM (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY store_id, item_id
               ORDER BY sort_order, created_at, id
             ) AS rn
      FROM list_items
      WHERE status = 'active'
    )
    WHERE rn = 1
  );
