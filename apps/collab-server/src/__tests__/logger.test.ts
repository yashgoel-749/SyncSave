import { logger } from '../logger';

describe('logger', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('writes info to stdout as valid JSON', () => {
    logger.info('hello world');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const raw = stdoutSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.trim());
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('hello world');
    expect(parsed.timestamp).toBeDefined();
  });

  it('writes error to stderr', () => {
    logger.error('something broke');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const raw = stderrSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.trim());
    expect(parsed.level).toBe('error');
  });

  it('includes meta when provided', () => {
    logger.info('with meta', { userId: 'abc' });
    const raw = stdoutSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(raw.trim());
    expect(parsed.meta).toEqual({ userId: 'abc' });
  });
});
