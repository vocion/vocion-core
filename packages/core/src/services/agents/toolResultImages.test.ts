import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { rasterizeChart, REVIEW_IMAGE_MAX_BYTES } from '@/libs/charts/raster';
import { reviewChart } from '@/libs/charts/review';
import { chartSpecSchema } from '@/libs/charts/spec';
import { chartReviewImage, dropSeenImages, takesToolResultImages, withImage } from './toolResultImages';
import { toolOutputContent } from './traceEmitter';

/** Monthly revenue with two forecast months (fictional numbers). */
const MONTHLY = chartSpecSchema.parse({
  title: 'On pace for $4.4M, December carried by pipeline',
  type: 'bar',
  x: ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  series: [
    { name: 'Invoiced', values: [390000, 412000, 401000, 430000, 120000, 60000] },
    { name: 'Weighted pipeline', values: [0, 0, 0, 0, 240000, 310000], forecast: true },
  ],
  stack: 'stack',
  aggregation: 'period',
  forecastFrom: 'Nov',
  format: 'currency',
  currency: 'USD',
  source: 'Ledger, monthly',
  asOf: '2026-10-24',
});

const model = (type: string) => ({ _llmType: () => type });

describe('which models take a picture in a tool result', () => {
  it('is read off the model the turn runs on, never its name', () => {
    expect(takesToolResultImages(model('anthropic'))).toBe(true);
    expect(takesToolResultImages(model('openai'))).toBe(false);
    expect(takesToolResultImages(model('chat_bedrock_converse'))).toBe(false);
    expect(takesToolResultImages(model('scripted'))).toBe(false);
    expect(takesToolResultImages(undefined)).toBe(false);
  });
});

describe('a chart review with its picture', () => {
  it('rasterizes the chart at a phone\'s width, at most 2x, under the size cap', async () => {
    const image = await rasterizeChart(MONTHLY);

    expect(image?.mimeType).toBe('image/webp');
    expect(image!.width).toBeGreaterThanOrEqual(390);
    expect(image!.width).toBeLessThanOrEqual(780);
    expect(image!.bytes).toBeLessThanOrEqual(REVIEW_IMAGE_MAX_BYTES);
  });

  it('sends no picture it cannot fit under the cap', async () => {
    expect(await rasterizeChart(MONTHLY, { maxBytes: 10 })).toBeNull();
  });

  it('puts the text first and one image after it, as an image_url data URL', async () => {
    const image = await chartReviewImage({ toolResultImages: true }, MONTHLY);
    const blocks = withImage('Rendered chart artifact #7.', image);

    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks).toHaveLength(2);
    expect((blocks as Array<{ type: string }>)[0]).toEqual({ type: 'text', text: 'Rendered chart artifact #7.' });
    expect((blocks as Array<{ type: string; image_url?: { url: string } }>)[1]!.image_url!.url).toMatch(/^data:image\/webp;base64,/);
  });

  it('keeps the text-only receipt where the model takes no picture', async () => {
    const image = await chartReviewImage({ toolResultImages: false }, MONTHLY);

    expect(image).toBeNull();
    expect(withImage('Rendered chart artifact #7.', image)).toBe('Rendered chart artifact #7.');
    expect(reviewChart(MONTHLY).text).toContain('a summary of the layout, not an image');
    expect(reviewChart(MONTHLY, { withImage: true }).text).toContain('the image below is the chart');
  });

  it('is stored and streamed as its text alone', async () => {
    const image = await chartReviewImage({ toolResultImages: true }, MONTHLY);
    const message = new ToolMessage({ content: withImage('Rendered chart artifact #7.', image) as never, tool_call_id: 'c1', name: 'render_chart' });

    expect(toolOutputContent(message)).toBe('Rendered chart artifact #7.');
  });
});

describe('a picture is seen once', () => {
  const picture = [{ type: 'text', text: 'Rendered chart artifact #7.' }, { type: 'image_url', image_url: { url: 'data:image/webp;base64,AAAA' } }];
  const call = (id: string) => new AIMessage({ content: '', tool_calls: [{ id, name: 'render_chart', args: {} }] });

  it('stays for the model call right after the tool that drew it', () => {
    const messages = [new HumanMessage('Chart that'), call('c1'), new ToolMessage({ content: picture as never, tool_call_id: 'c1', name: 'render_chart' })];

    expect(dropSeenImages(messages)).toBe(messages);
  });

  it('is replaced by a line of text on every later step', () => {
    const messages = [
      new HumanMessage('Chart that'),
      call('c1'),
      new ToolMessage({ content: picture as never, tool_call_id: 'c1', name: 'render_chart' }),
      call('c2'),
      new ToolMessage({ content: 'Updated', tool_call_id: 'c2', name: 'update_artifact' }),
    ];
    const out = dropSeenImages(messages);
    const seen = out[2] as ToolMessage;

    expect((seen.content as Array<{ type: string }>).some(b => b.type === 'image_url')).toBe(false);
    expect(toolOutputContent(seen)).toContain('Rendered chart artifact #7.');
    expect(seen.tool_call_id).toBe('c1');
    expect(out[4]).toBe(messages[4]);
  });
});
