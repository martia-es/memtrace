-- Tema visual por organización (accent color + border-radius preset). Ver ADR-019.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS theme JSONB NOT NULL DEFAULT '{}'::jsonb;
