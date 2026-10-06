import { readFileSync, existsSync } from "fs";

/**
 * Reads .env.local then .env into process.env, without overwriting anything
 * already set.
 *
 * Shared by the scripts that talk to live services, so there is one answer to
 * "where did this variable come from". An already-set variable always wins: that
 * is what makes `SUPABASE_DB_URL=… node scripts/db-size.mjs` work against a
 * database other than the one in the file, which is exactly what you want when
 * checking a restored copy.
 *
 * Note for anything it loads: `vercel env pull` writes NAME="" for every
 * variable it could not decrypt, so "defined" and "usable" are not the same
 * thing — callers should tell a blank value apart from a missing one.
 */
export function loadEnv(files = [".env.local", ".env"]) {
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const rawLine of readFileSync(file, "utf8").split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m || process.env[m[1]]) continue;
      let value = m[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[m[1]] = value;
    }
  }
}
