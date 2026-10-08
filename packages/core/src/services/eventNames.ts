/**
 * Event names that code outside the bus emits, in a leaf so naming one does
 * not import `services/EventService.ts` and everything it reaches
 * (`libs/eventBridge.ts`).
 */

/**
 * A credential was stored for a connector: a vendor login finished, a GitHub
 * App installation was recorded, or a person pasted a key. Emitted from the
 * one place every path goes through (`storeCredentialForSource`), so a plugin
 * can carry setup on from here — file the records the connection makes
 * possible, start the first read — instead of waiting for a person to come
 * back to chat. Not emitted for a token refresh, which changes nothing a
 * person did.
 */
export const SOURCE_CONNECTED = 'source.connected';
