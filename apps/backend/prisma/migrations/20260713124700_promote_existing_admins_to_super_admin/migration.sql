-- Preserve pre-existing admins' unrestricted access: before this change, role='admin' meant
-- access to every community, so every current admin becomes a super admin on rollout. New
-- admins created after this point default to isSuperAdmin=false (scoped, per community_admins).
UPDATE "users" SET "is_super_admin" = true WHERE "role" = 'admin';
