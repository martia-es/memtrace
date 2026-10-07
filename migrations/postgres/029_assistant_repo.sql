-- Repositorio del código del agente (ADR-064). Vive en el experimento (igual para DEV/PRE/PRO); la rama o tag que se
-- despliega en cada entorno vive en el despliegue. Solo metadatos: MemTrace no guarda credenciales del repositorio aquí.
-- NULL = el agente no declara repositorio. Idempotente.
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS repo_url TEXT;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS repo_provider TEXT;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS deploy_workflow TEXT;
ALTER TABLE experiments DROP CONSTRAINT IF EXISTS experiments_repo_provider_check;
ALTER TABLE experiments ADD CONSTRAINT experiments_repo_provider_check CHECK (repo_provider IS NULL OR repo_provider IN ('github', 'gitlab', 'bitbucket'));
ALTER TABLE experiments DROP CONSTRAINT IF EXISTS experiments_repo_pair_check;
ALTER TABLE experiments ADD CONSTRAINT experiments_repo_pair_check CHECK ((repo_url IS NULL) = (repo_provider IS NULL));

ALTER TABLE assistant_deployments ADD COLUMN IF NOT EXISTS deploy_ref TEXT;
