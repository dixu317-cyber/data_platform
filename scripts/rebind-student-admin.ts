import bcrypt from "bcryptjs";
import pg from "pg";

const { Client } = pg;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const client = new Client({
    connectionString: required("IDENTITY_MIGRATION_DATABASE_URL"),
  });
  const adminUsername = required("ADMIN_USERNAME").toLowerCase();
  const adminPassword = required("ADMIN_PASSWORD");
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE TABLE sessions");
    const result = await client.query(
      `
        UPDATE users
        SET username = $1,
            password_hash = $2,
            is_admin = TRUE
        WHERE is_admin = TRUE
        RETURNING id
      `,
      [adminUsername, passwordHash],
    );
    if (result.rowCount !== 1) {
      throw new Error("student snapshot must contain exactly one administrator");
    }
    const invalid = await client.query(
      `
        SELECT COUNT(*)::INTEGER AS count
        FROM users
        WHERE is_admin = FALSE
          AND username !~ '^student[0-9]{2}$'
      `,
    );
    if (Number(invalid.rows[0]?.count ?? -1) !== 0) {
      throw new Error("student snapshot contains a non-anonymized username");
    }
    await client.query("COMMIT");
    console.log(`student administrator rebound: ${adminUsername}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(
    "failed to rebind student administrator:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
