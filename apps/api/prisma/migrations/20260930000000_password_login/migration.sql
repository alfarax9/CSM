-- Login email + password sementara (AUTH_MODE=password). Hanya hash scrypt yang disimpan.
ALTER TABLE "users" ADD COLUMN "password_hash" TEXT;
