export function validateAuthConfig(config) {
  const methods = [Boolean(config.token), Boolean(config.cookie), Boolean(config.email || config.password)].filter(Boolean).length;
  if (Boolean(config.email) !== Boolean(config.password)) {
    throw new Error("Inputs 'affine-email' and 'affine-password' must be provided together.");
  }
  if (methods === 0) {
    throw new Error("Configure one AFFiNE authentication method: 'affine-token', 'affine-cookie', or 'affine-email' with 'affine-password'.");
  }
  if (methods > 1) {
    throw new Error('Configure only one AFFiNE authentication method.');
  }
}
