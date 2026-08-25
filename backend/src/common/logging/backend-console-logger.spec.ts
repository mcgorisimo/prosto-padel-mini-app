import { createBackendConsoleLogger } from './backend-console-logger';

describe('createBackendConsoleLogger', () => {
  it('writes one parseable JSON line with structured message fields', () => {
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    try {
      createBackendConsoleLogger().log({
        event: 'logging_contract_probe',
        outcome: 'success',
      });

      expect(write).toHaveBeenCalledTimes(1);
      const output = String(write.mock.calls[0]?.[0]);
      expect(output.endsWith('\n')).toBe(true);
      expect(output.trim()).not.toContain('\n');
      expect(JSON.parse(output)).toMatchObject({
        level: 'log',
        message: {
          event: 'logging_contract_probe',
          outcome: 'success',
        },
      });
    } finally {
      write.mockRestore();
    }
  });
});
