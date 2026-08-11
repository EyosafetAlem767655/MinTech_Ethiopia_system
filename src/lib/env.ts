export function envValue(name: string): string {
  return (process.env[name] || "").trim();
}

export function hasEnv(name: string): boolean {
  return envValue(name).length > 0;
}

export function requireEnv(name: string, purpose: string): string {
  const value = envValue(name);
  if (!value) {
    throw new Error(
      `${name} is required for ${purpose}. Add it in Vercel Project Settings > Environment Variables for Production and Preview, then redeploy.`
    );
  }
  return value;
}

export function appUrl(): string {
  return envValue("APP_URL").replace(/\/+$/, "");
}

export function missingEnv(names: string[]): string[] {
  return names.filter((name) => !hasEnv(name));
}

export interface EnvCheck {
  configured: boolean;
  required: string[];
  missing: string[];
  warnings: string[];
}

export function integrationEnvChecks(): Record<string, EnvCheck> {
  const checks: Record<string, EnvCheck> = {
    supabase: check(["SUPABASE_DB_URL", "SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_URL"]),
    ai: check(["NIVIDA_API_KEY", "QWEN_API"]),
    telegram: check(["TELEGRAM_BOT_TOKEN", "TELEGRAM_CEO_CHAT_ID", "TELEGRAM_WEBHOOK_SECRET", "APP_URL"]),
    cron: check(["CRON_SECRET"]),
    push: check(["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "NEXT_PUBLIC_VAPID_PUBLIC_KEY"]),
    dashboardAuth: check(["ADMIN_PASSWORD"]),
  };

  if (hasEnv("CRON_SECRETVAPID_PUBLIC_KEY")) {
    checks.cron.warnings.push(
      "CRON_SECRETVAPID_PUBLIC_KEY is not used by the app. Split it into separate CRON_SECRET and VAPID_PUBLIC_KEY variables."
    );
    checks.push.warnings.push(
      "CRON_SECRETVAPID_PUBLIC_KEY is not used by the app. VAPID_PUBLIC_KEY must be its own variable."
    );
  }

  const publicVapid = envValue("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  const serverVapid = envValue("VAPID_PUBLIC_KEY");
  if (publicVapid && serverVapid && publicVapid !== serverVapid) {
    checks.push.warnings.push("NEXT_PUBLIC_VAPID_PUBLIC_KEY must match VAPID_PUBLIC_KEY.");
  }

  const url = appUrl();
  if (url && !/^https:\/\/.+/.test(url)) {
    checks.telegram.warnings.push("APP_URL should be the deployed HTTPS Vercel URL with no trailing slash.");
  }

  return checks;
}

function check(required: string[]): EnvCheck {
  const missing = missingEnv(required);
  return { configured: missing.length === 0, required, missing, warnings: [] };
}
