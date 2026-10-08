import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bedrockMode, claudeChildEnv, defaultModel, engineerModel, missingModelCredential, STRIPPED_KEYS } from './bedrock.mjs';

// What a Fargate task's environment holds: the worker's tokens, the model key, the task role's
// credentials endpoint, the region, and AWS variables the engineer has no use for.
const fargate = {
  PATH: '/usr/bin',
  HOME: '/home/runner',
  ANTHROPIC_API_KEY: 'sk-ant-fixture',
  GITHUB_TOKEN: 'ghp_fixture',
  GH_TOKEN: 'ghp_fixture',
  VOCION_TOKEN: 'vcn_fixture',
  VOCION_RUNNER_TOKEN: 'vcn_runner_fixture',
  AWS_ACCESS_KEY_ID: 'AKIAFIXTURE',
  AWS_SECRET_ACCESS_KEY: 'fixture-secret',
  AWS_SESSION_TOKEN: 'fixture-session',
  AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/fixture',
  AWS_REGION: 'us-east-1',
  AWS_DEFAULT_REGION: 'us-east-1',
  AWS_EXECUTION_ENV: 'AWS_ECS_FARGATE',
  AWS_PROFILE: 'northwind',
  ECS_CONTAINER_METADATA_URI_V4: 'http://169.254.170.2/v4/fixture',
};

test('by default the engineer keeps everything but the worker tokens and the AWS credentials, as before', () => {
  const child = claudeChildEnv(fargate);
  const expected = { ...fargate };
  for (const k of ['GITHUB_TOKEN', 'GH_TOKEN', 'VOCION_TOKEN', 'VOCION_RUNNER_TOKEN', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', 'AWS_CONTAINER_CREDENTIALS_FULL_URI', 'AWS_CONTAINER_AUTHORIZATION_TOKEN']) {
    delete expected[k];
  }
  assert.deepEqual(child, expected);
  assert.deepEqual(STRIPPED_KEYS, ['GITHUB_TOKEN', 'GH_TOKEN', 'VOCION_TOKEN', 'VOCION_RUNNER_TOKEN', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', 'AWS_CONTAINER_CREDENTIALS_FULL_URI', 'AWS_CONTAINER_AUTHORIZATION_TOKEN']);
  assert.equal(child.ANTHROPIC_API_KEY, 'sk-ant-fixture');
});

test('on Bedrock the engineer keeps the task role endpoint and the region, and no other AWS variable', () => {
  const parent = { ...fargate, CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_MODEL: 'us.anthropic.claude-sonnet-4-6', ANTHROPIC_SMALL_FAST_MODEL: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' };
  const child = claudeChildEnv(parent);
  assert.deepEqual(Object.keys(child).filter(k => k.startsWith('AWS_')).sort(), ['AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', 'AWS_DEFAULT_REGION', 'AWS_REGION']);
  assert.equal(child.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI, '/v2/credentials/fixture');
  assert.equal(child.CLAUDE_CODE_USE_BEDROCK, '1');
  assert.equal(child.ANTHROPIC_MODEL, 'us.anthropic.claude-sonnet-4-6');
  assert.equal(child.ANTHROPIC_SMALL_FAST_MODEL, 'us.anthropic.claude-haiku-4-5-20251001-v1:0');
  for (const k of ['GITHUB_TOKEN', 'GH_TOKEN', 'VOCION_TOKEN', 'VOCION_RUNNER_TOKEN']) {
    assert.equal(child[k], undefined, k);
  }
  assert.equal(child.ECS_CONTAINER_METADATA_URI_V4, fargate.ECS_CONTAINER_METADATA_URI_V4);
});

test('the authorization token goes with the full URI, and only with it', () => {
  const full = claudeChildEnv({ CLAUDE_CODE_USE_BEDROCK: 'true', AWS_CONTAINER_CREDENTIALS_FULL_URI: 'http://127.0.0.1/creds', AWS_CONTAINER_AUTHORIZATION_TOKEN: 'fixture', AWS_REGION: 'eu-west-1' });
  assert.equal(full.AWS_CONTAINER_CREDENTIALS_FULL_URI, 'http://127.0.0.1/creds');
  assert.equal(full.AWS_CONTAINER_AUTHORIZATION_TOKEN, 'fixture');
  const relative = claudeChildEnv({ CLAUDE_CODE_USE_BEDROCK: '1', AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/x', AWS_CONTAINER_AUTHORIZATION_TOKEN: 'fixture' });
  assert.equal(relative.AWS_CONTAINER_AUTHORIZATION_TOKEN, undefined);
});

test('Bedrock mode is Claude Code\'s own switch, and only a true value turns it on', () => {
  assert.equal(bedrockMode({ CLAUDE_CODE_USE_BEDROCK: '1' }), true);
  assert.equal(bedrockMode({ CLAUDE_CODE_USE_BEDROCK: 'TRUE' }), true);
  assert.equal(bedrockMode({ CLAUDE_CODE_USE_BEDROCK: '0' }), false);
  assert.equal(bedrockMode({ CLAUDE_CODE_USE_BEDROCK: '' }), false);
  assert.equal(bedrockMode({}), false);
});

test('the default model: DEFAULT_MODEL, else on Bedrock ANTHROPIC_MODEL, else sonnet', () => {
  assert.equal(defaultModel({}), 'sonnet');
  assert.equal(defaultModel({ ANTHROPIC_MODEL: 'us.anthropic.claude-sonnet-4-6' }), 'sonnet');
  assert.equal(defaultModel({ CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_MODEL: 'us.anthropic.claude-sonnet-4-6' }), 'us.anthropic.claude-sonnet-4-6');
  assert.equal(defaultModel({ CLAUDE_CODE_USE_BEDROCK: '1' }), 'sonnet');
  assert.equal(defaultModel({ CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_MODEL: 'x', DEFAULT_MODEL: 'opus' }), 'opus');
});

test('on Bedrock a contract\'s bare claude- model becomes the region\'s inference profile', () => {
  const us = { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-west-2' };
  assert.equal(engineerModel('claude-sonnet-4-6', us), 'us.anthropic.claude-sonnet-4-6');
  assert.equal(engineerModel('claude-haiku-4-5-20251001', us), 'us.anthropic.claude-haiku-4-5-20251001-v1:0');
  assert.equal(engineerModel('claude-opus-5', { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'eu-central-1' }), 'eu.anthropic.claude-opus-5');
  assert.equal(engineerModel('claude-opus-5', { CLAUDE_CODE_USE_BEDROCK: '1', AWS_DEFAULT_REGION: 'ap-southeast-2' }), 'apac.anthropic.claude-opus-5');
  assert.equal(engineerModel('sonnet', us), 'sonnet');
  assert.equal(engineerModel('us.anthropic.claude-sonnet-4-6', us), 'us.anthropic.claude-sonnet-4-6');
  assert.equal(engineerModel('claude-sonnet-4-6', { AWS_REGION: 'us-west-2' }), 'claude-sonnet-4-6');
});

test('the model credential: the Anthropic key by default, the container role on Bedrock', () => {
  assert.equal(missingModelCredential({ ANTHROPIC_API_KEY: 'sk-ant-fixture' }), null);
  assert.equal(missingModelCredential({}), 'ANTHROPIC_API_KEY is not set');
  assert.equal(missingModelCredential({ CLAUDE_CODE_USE_BEDROCK: '1', AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/x' }), null);
  assert.match(missingModelCredential({ CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_API_KEY: 'sk-ant-fixture' }), /no container credentials/);
});
