/**
 * Keychain stub — typed to match the real keytar interface so it can be
 * replaced later without changing call sites. All operations log a warning
 * and return undefined/void rather than throwing.
 */

/** Retrieve a password from the system keychain (stub). */
export async function getPassword(
  service: string,
  account: string
): Promise<string | undefined> {
  process.stderr.write(
    `keychain not configured — getPassword(${service}, ${account}) skipped\n`
  );
  return undefined;
}

/** Store a password in the system keychain (stub). */
export async function setPassword(
  service: string,
  account: string,
  password: string
): Promise<void> {
  process.stderr.write(
    `keychain not configured — setPassword(${service}, ${account}) skipped\n`
  );
  void password;
}

/** Delete a password from the system keychain (stub). */
export async function deletePassword(
  service: string,
  account: string
): Promise<boolean> {
  process.stderr.write(
    `keychain not configured — deletePassword(${service}, ${account}) skipped\n`
  );
  return false;
}
