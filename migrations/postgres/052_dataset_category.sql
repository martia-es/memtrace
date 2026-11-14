-- Categoría opcional de un dataset (funcional, seguridad…) para clasificarlos y filtrarlos en el dashboard.
-- NULL = sin categoría. Conjunto cerrado: un valor nuevo exige ampliar este CHECK. Idempotente.
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE datasets DROP CONSTRAINT IF EXISTS datasets_category_check;
ALTER TABLE datasets ADD CONSTRAINT datasets_category_check
    CHECK (category IS NULL OR category IN ('functional', 'security', 'regression', 'other'));
