/**
 * What a Bedrock model id costs.
 *
 * `chargeUsage` (`services/BudgetService.ts:160`) prices a turn by the
 * model id the provider reported. Bedrock reports decorated ids
 * (`us.anthropic.claude-sonnet-4-6`), the table is keyed by plain model
 * names, and an unknown id costs 0, so before the canonicaliser every
 * Bedrock turn was free and no cents cap could ever bind. These tests
 * pin that the two Bedrock chat models of `libs/llm/langchain.ts`
 * `DEFAULTS` price like their plain ids, that an id the table does not
 * cover still costs 0, and that the Langfuse match pattern the
 * bootstrap script registers is escaped.
 *
 * The ids are written out rather than imported from `libs/llm/langchain.ts`:
 * `DEFAULTS` is module-private there, and importing that module would
 * drag the whole LangChain stack into a pure unit test.
 */
import { describe, expect, it } from 'vitest';
import { canonicalModelId, knownModels, modelMatchPattern, PRICING, tokenCostCents } from './pricing';

/** One million input tokens, makes a cost read as "cents per million". */
const ONE_M_INPUT = { inputTokens: 1_000_000 };

/** Bedrock `DEFAULTS` chat ids (`libs/llm/langchain.ts`, bedrock block). */
const BEDROCK_MAIN = 'us.anthropic.claude-sonnet-4-6';
const BEDROCK_CLASSIFIER = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
/** The id the Veerio workspace pins for its agents. */
const WORKSPACE_MAIN = 'global.anthropic.claude-sonnet-4-6';

describe('canonicalModelId', () => {
  it('strips the inference-profile, vendor and version decoration', () => {
    expect(canonicalModelId(BEDROCK_MAIN)).toBe('claude-sonnet-4-6');
    expect(canonicalModelId(BEDROCK_CLASSIFIER)).toBe('claude-haiku-4-5-20251001');
    expect(canonicalModelId(WORKSPACE_MAIN)).toBe('claude-sonnet-4-6');
  });

  it('leaves an undecorated id alone', () => {
    expect(canonicalModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(canonicalModelId('gpt-4o')).toBe('gpt-4o');
    // Titan: no `amazon.` rule, and `-v1` is not the `-v<major>:<minor>`
    // suffix Bedrock appends, so nothing is stripped.
    expect(canonicalModelId('amazon.titan-embed-text-v1')).toBe('amazon.titan-embed-text-v1');
  });
});

describe('tokenCostCents', () => {
  it('prices the Bedrock chat ids exactly like their plain ids', () => {
    const sonnet = tokenCostCents('claude-sonnet-4-6', ONE_M_INPUT);
    const haiku = tokenCostCents('claude-haiku-4-5-20251001', ONE_M_INPUT);

    expect(sonnet).toBeGreaterThan(0);
    expect(haiku).toBeGreaterThan(0);
    expect(tokenCostCents(BEDROCK_MAIN, ONE_M_INPUT)).toBe(sonnet);
    expect(tokenCostCents(BEDROCK_CLASSIFIER, ONE_M_INPUT)).toBe(haiku);
    expect(tokenCostCents(WORKSPACE_MAIN, ONE_M_INPUT)).toBe(sonnet);
  });

  it('still prices Titan at 0, it is an embedding model, not a chat model', () => {
    // Deliberate: the embedder bills through its own path, and guessing
    // a price for a model card we never listed would be worse than 0.
    expect(tokenCostCents('amazon.titan-embed-text-v1', ONE_M_INPUT)).toBe(0);
    expect(tokenCostCents('some-model-nobody-priced', ONE_M_INPUT)).toBe(0);
  });

  it('takes the exact id over the canonical one', () => {
    // Every key of the table must price off its own tier, untouched by
    // canonicalisation, including any full provider id added later.
    for (const model of knownModels()) {
      expect(tokenCostCents(model, ONE_M_INPUT)).toBe(PRICING[model]!.inputCentsPerMillion);
    }
  });

  it('charges cache reads at the discounted rate', () => {
    const full = tokenCostCents(BEDROCK_MAIN, { inputTokens: 1_000_000 });
    const cached = tokenCostCents(BEDROCK_MAIN, { inputTokens: 1_000_000, cacheReadTokens: 1_000_000 });

    expect(cached).toBeLessThan(full);
    expect(cached).toBe(PRICING['claude-sonnet-4-6']!.cacheReadCentsPerMillion);
  });
});

describe('modelMatchPattern', () => {
  // Langfuse reads `(?i)` as a flag; JavaScript needs it as the `i` flag.
  const asJsRegExp = (pattern: string) => new RegExp(pattern.replace(/^\(\?i\)/, ''), 'i');

  it('matches the id case-insensitively and nothing longer', () => {
    const re = asJsRegExp(modelMatchPattern('claude-sonnet-4-6'));

    expect(re.test('claude-sonnet-4-6')).toBe(true);
    expect(re.test('Claude-Sonnet-4-6')).toBe(true);
    expect(re.test('claude-sonnet-4-6x')).toBe(false);
    expect(re.test('xclaude-sonnet-4-6')).toBe(false);
  });

  it('escapes the dots in a Bedrock id', () => {
    const re = asJsRegExp(modelMatchPattern(BEDROCK_MAIN));

    expect(re.test(BEDROCK_MAIN)).toBe(true);
    // Unescaped, `.` would match any character and this would pass.
    expect(re.test('usXanthropicXclaude-sonnet-4-6')).toBe(false);
  });
});
