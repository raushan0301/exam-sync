/**
 * Deterministic default password for a bulk/admin-provisioned account:
 * `{identifier}_{fullname-lowercase-no-spaces}` — e.g. roll number
 * "CSE2026001" + name "Jane Doe" -> "CSE2026001_janedoe"; employee code
 * "FAC001" + name "John Smith" -> "FAC001_johnsmith".
 *
 * Deliberately predictable (identifier is already known to whoever needs
 * to give this person their first login) rather than a random string that
 * would need a separate delivery channel (email/SMS) this project doesn't
 * have wired up yet. The account this password is set on is created with
 * `mustChangePassword: true`, so it can never be used past the very first
 * login — see AuthService.changePassword.
 */
export function generateDefaultPassword(identifier: string, fullName: string): string {
  const namePart = fullName.toLowerCase().replace(/\s+/g, '');
  return `${identifier}_${namePart}`;
}
