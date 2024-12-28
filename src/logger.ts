const logLevelNumber = {
  trace: 0,
  debug: 1,
  info: 2,
  warning: 3,
  error: 5,
} as const;

export class Logger {
  constructor(public logLevel: keyof typeof logLevelNumber = "info") {}

  trace(...args: Parameters<typeof console.trace>) {
    if (logLevelNumber[this.logLevel] > logLevelNumber["trace"]) return;
    console.trace(...args);
  }

  debug(...args: Parameters<typeof console.info>) {
    if (logLevelNumber[this.logLevel] > logLevelNumber["debug"]) return;
    console.info(...args);
  }

  info(...args: Parameters<typeof console.info>) {
    if (logLevelNumber[this.logLevel] > logLevelNumber["info"]) return;
    console.info(...args);
  }

  warn(...args: Parameters<typeof console.warn>) {
    if (logLevelNumber[this.logLevel] > logLevelNumber["warning"]) return;
    console.warn(...args);
  }

  error(...args: Parameters<typeof console.error>) {
    if (logLevelNumber[this.logLevel] > logLevelNumber["error"]) return;
    console.error(...args);
  }
}
