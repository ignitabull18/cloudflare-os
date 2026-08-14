const SANDBOX_ID_PREFIX = "opencli-";
const MAX_SANDBOX_ID_LENGTH = 63;

export function sandboxIdForDurableObject(durableObjectId: string): string {
  return `${SANDBOX_ID_PREFIX}${durableObjectId.slice(0, MAX_SANDBOX_ID_LENGTH - SANDBOX_ID_PREFIX.length)}`;
}
