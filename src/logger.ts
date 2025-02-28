import fs from "fs";
import { Console } from "console";

const logLevelNumber = {
  trace: 0,
  debug: 1,
  info: 2,
  warning: 3,
  error: 4,
} as const;

export function makeFileConsole(file: string): Console {
  const writeStream = fs.createWriteStream(file, { flags: "a" });
  return new Console(writeStream, writeStream);
}

export function onlyForLogLevel(
  console: Console,
  logLevel: keyof typeof logLevelNumber
): Console {
  return {
    ...console,
    log(message?: any, ...optionalParams: any[]) {
      console.log(message, ...optionalParams);
    },
    trace(message?: any, ...optionalParams: any[]) {
      if (logLevelNumber[logLevel] > logLevelNumber["trace"]) return;
      console.trace(message, ...optionalParams);
    },
    debug(message?: any, ...optionalParams: any[]) {
      if (logLevelNumber[logLevel] > logLevelNumber["debug"]) return;
      console.debug(message, ...optionalParams);
    },
    info(message?: any, ...optionalParams: any[]) {
      if (logLevelNumber[logLevel] > logLevelNumber["info"]) return;
      console.info(message, ...optionalParams);
    },
    warn(message?: any, ...optionalParams: any[]) {
      if (logLevelNumber[logLevel] > logLevelNumber["warning"]) return;
      console.warn(message, ...optionalParams);
    },
    error(message?: any, ...optionalParams: any[]) {
      if (logLevelNumber[logLevel] > logLevelNumber["error"]) return;
      console.error(message, ...optionalParams);
    },
  };
}
