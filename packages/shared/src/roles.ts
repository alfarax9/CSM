/** Role user (PRD §3). Role adalah enum di `users.role`, bukan tabel. */
export const ROLES = ['super_admin', 'admin', 'sales'] as const;
export type Role = (typeof ROLES)[number];

/** Role yang boleh diberikan oleh setiap role saat mendaftarkan user. */
export const ASSIGNABLE_ROLES: Record<Role, readonly Role[]> = {
  super_admin: ['super_admin', 'admin', 'sales'],
  admin: ['admin', 'sales'],
  sales: [],
};
