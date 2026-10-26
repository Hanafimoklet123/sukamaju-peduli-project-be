ALTER TABLE users ADD COLUMN deleted_at timestamptz;
ALTER TABLE categories ADD COLUMN deleted_at timestamptz;
ALTER TABLE users ADD CONSTRAINT deleted_user_inactive CHECK (deleted_at IS NULL OR state='inactive');
ALTER TABLE categories ADD CONSTRAINT deleted_category_inactive CHECK (deleted_at IS NULL OR NOT active);
