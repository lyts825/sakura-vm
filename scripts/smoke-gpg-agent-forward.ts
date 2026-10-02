// The former named-pipe protocol mock did not exercise native Windows GnuPG.
// Keep the npm entry point, with the real identity smoke's read-only default.
// Replacement checks start the project body and prove Agent refusal before nonce.
const args = process.argv.slice(2);
if (args.length === 3) process.argv.push('--validate-only');
await import('./smoke-gpg-agent-project-identity.ts');
export {};
