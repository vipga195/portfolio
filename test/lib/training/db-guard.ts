// Safety check for tests that TRUNCATE tables: only a throwaway local database may be used.
// Returns null when the URL is acceptable, otherwise the reason (never includes the URL itself).
export function checkTestDatabaseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "TEST_DATABASE_URL is not a valid URL";
  }
  if (!["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)) return "TEST_DATABASE_URL host must be loopback (127.0.0.1, ::1 or localhost)";
  if (url.port === "" || url.port === "5432") return "TEST_DATABASE_URL must use an explicit port other than 5432";
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (database === "") return "TEST_DATABASE_URL must name a database";
  if (database === "portfolio") return 'TEST_DATABASE_URL must not point at a database named "portfolio"';
  return null;
}
