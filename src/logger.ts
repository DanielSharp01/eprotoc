import fs from "fs";
import util from "util";

const logLevelNumber = {
  trace: 0,
  debug: 1,
  info: 2,
  warning: 3,
  error: 5,
} as const;

export interface Console {
  log(message?: any, ...optionalParams: any[]): void;
  trace(message?: any, ...optionalParams: any[]): void;
  debug(message?: any, ...optionalParams: any[]): void;
  info(message?: any, ...optionalParams: any[]): void;
  warn(message?: any, ...optionalParams: any[]): void;
  error(message?: any, ...optionalParams: any[]): void;
}

export function makeFileConsole(file: string) {
  const logStream = fs.createWriteStream(file, { flags: "a" });
  return {
    log(message?: any, ...optionalParams: any[]) {
      logStream.write(util.format(message, ...optionalParams));
      logStream.write("\n");
    },
    trace(message?: any, ...optionalParams: any[]) {
      logStream.write(util.format(message, ...optionalParams));
      logStream.write("\n");
    },
    debug(message?: any, ...optionalParams: any[]) {
      logStream.write(util.format(message, ...optionalParams));
      logStream.write("\n");
    },
    info(message?: any, ...optionalParams: any[]) {
      logStream.write(util.format(message, ...optionalParams));
      logStream.write("\n");
    },
    warn(message?: any, ...optionalParams: any[]) {
      logStream.write(util.format(message, ...optionalParams));
      logStream.write("\n");
    },
    error(message?: any, ...optionalParams: any[]) {
      logStream.write(util.format(message, ...optionalParams));
      logStream.write("\n");
    },
  };
}

export class Logger {
  constructor(
    public logLevel: keyof typeof logLevelNumber = "info",
    public logConsole: Console = console
  ) {}

  log(...args: Parameters<Console["debug"]>) {
    this.logConsole.log(...args);
  }

  trace(...args: Parameters<Console["trace"]>) {
    if (logLevelNumber[this.logLevel] > logLevelNumber["trace"]) return;
    this.logConsole.trace(...args);
  }

  debug(...args: Parameters<Console["debug"]>) {
    if (logLevelNumber[this.logLevel] > logLevelNumber["debug"]) return;
    this.logConsole.info(...args);
  }

  info(...args: Parameters<Console["info"]>) {
    if (logLevelNumber[this.logLevel] > logLevelNumber["info"]) return;
    this.logConsole.info(...args);
  }

  warn(...args: Parameters<Console["warn"]>) {
    if (logLevelNumber[this.logLevel] > logLevelNumber["warning"]) return;
    this.logConsole.warn(...args);
  }

  error(...args: Parameters<Console["error"]>) {
    if (logLevelNumber[this.logLevel] > logLevelNumber["error"]) return;
    this.logConsole.error(...args);
  }
}
