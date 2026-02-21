import http from 'http';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { app, createLogThrottle } from '../server.js';

function request(pathname, port) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: pathname, method: 'GET' },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body });
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('server', () => {
  test('GET / responds with health text', async () => {
    const testServer = app.listen(0);
    const address = testServer.address();
    const port = typeof address === 'object' && address ? address.port : null;

    try {
      const response = await request('/', port);
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('Game server live');
    } finally {
      await new Promise((resolve) => testServer.close(resolve));
    }
  });

  test('createLogThrottle limits logs based on interval', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const nowSpy = jest.spyOn(Date, 'now');
    const throttledLog = createLogThrottle(2);

    nowSpy.mockReturnValue(1000);
    throttledLog('first');

    nowSpy.mockReturnValue(1200);
    throttledLog('second');

    nowSpy.mockReturnValue(1500);
    throttledLog('third');

    expect(consoleSpy).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenNthCalledWith(1, 'first');
    expect(consoleSpy).toHaveBeenNthCalledWith(2, 'third');
  });
});
