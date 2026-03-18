CREATE TABLE IF NOT EXISTS rbac_roles (
  user_id VARCHAR(100) PRIMARY KEY,
  role VARCHAR(20) NOT NULL,
  allowed_tables TEXT[] NOT NULL,
  allow_crud BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rbac_roles_role ON rbac_roles (role);
