/**
 * `gh auth login <token>` takes a secret as a plain argument. The dedicated
 * sign-in panel masks it with type="password"; the terminal has no
 * equivalent, so without this the token would sit in cleartext in the
 * scrollback and up-arrow history for the rest of the session.
 */
export function maskSensitiveCommand(cmd: string): string {
  const match = cmd.match(/^(\s*gh\s+auth\s+login\s+)(\S+)(.*)$/i);
  if (!match) return cmd;
  return `${match[1]}${"*".repeat(8)}${match[3]}`;
}
