/**
 * A window event the chat raises when a turn creates or revises an artifact
 * (`detail` is the `ArtifactPayload`). A page showing that artifact takes
 * the new version in place instead of waiting for a reload.
 */
export const ARTIFACT_EVENT = 'vocion:artifact';
