import { describe, expect, it } from 'vitest';
import { readJsonObject } from '@/lib/write-route';
import { isPythonFalsyJson, parsePythonIntValue } from '@/lib/api-params';

function jsonRequest(body: string, contentType = 'application/json') {
  return new Request('http://fixture.invalid/api/web/post', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  });
}

describe('write JSON parsing', () => {
  it('preserves unsafe integer tokens as bigint without changing safe integers or floats', async () => {
    const value = await readJsonObject(jsonRequest(
      '{"project_id":9007199254740993,"safe":10,"fraction":10.5,"negative":-9007199254740993}',
    ));
    expect(value).toEqual({
      project_id: 9007199254740993n,
      safe: 10,
      fraction: 10.5,
      negative: -9007199254740993n,
    });
    expect(parsePythonIntValue(value.project_id)).toBe(9007199254740993n);
  });

  it('matches Flask silent parsing for malformed, empty, and null JSON', async () => {
    expect(await readJsonObject(jsonRequest('{'))).toEqual({});
    expect(await readJsonObject(jsonRequest(''))).toEqual({});
    expect(await readJsonObject(jsonRequest('null'))).toEqual({});
  });

  it('accepts application media types with a +json suffix', async () => {
    expect(await readJsonObject(jsonRequest('{"did":"x"}', 'application/vnd.api+json')))
      .toEqual({ did: 'x' });
  });

  it('matches Python truthiness for non-object JSON values', async () => {
    await expect(readJsonObject(jsonRequest('true'))).rejects.toThrow(TypeError);
    await expect(readJsonObject(jsonRequest('[1]'))).rejects.toThrow(TypeError);
    await expect(readJsonObject(jsonRequest('"x"'))).rejects.toThrow(TypeError);
    expect(await readJsonObject(jsonRequest('false'))).toEqual({});
    expect(await readJsonObject(jsonRequest('0'))).toEqual({});
    expect(await readJsonObject(jsonRequest('[]'))).toEqual({});
  });

  it('matches Python truthiness for empty and non-empty JSON containers', () => {
    expect(isPythonFalsyJson([])).toBe(true);
    expect(isPythonFalsyJson({})).toBe(true);
    expect(isPythonFalsyJson([0])).toBe(false);
    expect(isPythonFalsyJson({ value: 0 })).toBe(false);
  });
});
